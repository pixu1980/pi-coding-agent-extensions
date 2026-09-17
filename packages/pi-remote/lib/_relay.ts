/**
 * pi-remote - relay WebSocket client (zero dependencies)
 *
 * Wire-compatible with remote_pi's relay (`relay/src`, `PROTOCOL.md`):
 *
 *   → {"type":"hello","pubkey":"<std-base64 Ed25519>","room_id"?,"room_meta"?}
 *   ← {"type":"challenge","nonce":"<std-base64 32B>"} | {"type":"error",...}
 *   → {"type":"auth","sig":"<std-base64 64B over raw nonce>"}
 *
 * The relay sends no explicit OK — it simply starts routing. Post-auth
 * traffic is JSONL outer envelopes `{peer, ct}` (see `_extension.ts`).
 *
 * Transport is injectable (`SocketFactory`) so tests run without network;
 * production uses the Node 22 global WebSocket — no `ws` package needed.
 * Liveness mirrors remote_pi: the relay pings every ~25 s, so silence past
 * ~70 s means a half-open socket and we force-close to trigger reconnect.
 */

import { EventEmitter } from 'node:events';
import { ed25519Sign, type Identity } from './_identity.ts';

export const AUTH_TIMEOUT_MS = 5_000;
const OPEN_TIMEOUT_MS = 10_000;
const LIVENESS_TIMEOUT_MS = 70_000;
const LIVENESS_CHECK_MS = 20_000;
const RECONNECT_BACKOFFS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Relay rejected hello because another peer holds (pubkey, room_id). */
export class RoomAlreadyOpenError extends Error {
  constructor(public readonly roomId: string | undefined) {
    super(
      roomId
        ? `relay rejected hello: room ${roomId} already open for this peer`
        : 'relay rejected hello: peer already connected'
    );
    this.name = 'RoomAlreadyOpenError';
  }
}

export interface RoomMeta {
  name: string;
  cwd: string;
  model?: string;
}

export interface ConnectOptions {
  roomId?: string;
  roomMeta?: RoomMeta;
}

/** Minimal socket surface; implemented by the global-WebSocket adapter and test fakes. */
export interface RelaySocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export type SocketFactory = (url: string) => RelaySocket;

/** Production adapter over the Node 22 / browser global WebSocket. */
export class GlobalWebSocketAdapter implements RelaySocket {
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  private readonly ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onopen?.();
    this.ws.onmessage = (ev: MessageEvent) => {
      const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8');
      this.onmessage?.(data);
    };
    this.ws.onclose = () => this.onclose?.();
    this.ws.onerror = () => this.onerror?.(new Error('websocket error'));
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}

export function defaultSocketFactory(url: string): RelaySocket {
  return new GlobalWebSocketAdapter(url);
}

export interface RelayClientOptions {
  socketFactory?: SocketFactory;
}

export class RelayClient extends EventEmitter {
  private sock: RelaySocket | null = null;
  private connected = false;
  private everAuthed = false;
  private explicitClose = false;
  private disposed = false;
  private backoffAttempt = 0;
  private lastActivityAt = 0;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authWaiter: ((line: string) => void) | null = null;
  private pendingRoom: ConnectOptions = {};

  constructor(
    private readonly url: string,
    private readonly identity: Identity,
    private readonly options: RelayClientOptions = {}
  ) {
    super();
  }

  /** Current authed state. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Opens the socket and completes Ed25519 auth. Resolves once the relay
   * starts routing (no explicit OK on the wire). Throws RoomAlreadyOpenError
   * when the relay rejects the hello, Error on timeout/network failure.
   * Auto-reconnect engages only AFTER a first successful auth; a failed
   * initial dial rejects and leaves the client idle.
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this.disposed) throw new Error('relay: client disposed');
    if (this.connected) return;
    this.explicitClose = false;
    this.pendingRoom = options;
    await this.dial(false);
  }

  /** Sends one JSONL line. Throws when not connected (callers may drop frames). */
  send(line: string): void {
    if (!this.connected || !this.sock) throw new Error('relay: not connected');
    this.sock.send(line);
  }

  /** Graceful shutdown: no reconnect, timers cleared. */
  close(): void {
    this.explicitClose = true;
    this.clearReconnect();
    this.stopLiveness();
    this.connected = false;
    try {
      this.sock?.close();
    } catch {
      /* already gone */
    }
    this.sock = null;
  }

  /** Permanent teardown (also removes listeners). */
  dispose(): void {
    this.disposed = true;
    this.close();
    this.removeAllListeners();
  }

  // ── Dial + auth ────────────────────────────────────────────────────

  private dial(isReconnect: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const factory = this.options.socketFactory ?? defaultSocketFactory;
      let sock: RelaySocket;
      try {
        sock = factory(this.url);
      } catch (err) {
        if (!isReconnect) reject(err);
        else this.emitError(err);
        return;
      }
      this.sock = sock;
      let settled = false;

      const openTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.authWaiter = null;
          try {
            sock.close();
          } catch {
            /* ignore */
          }
          const err = new Error('relay: connect timeout');
          if (!isReconnect) reject(err);
          else this.emitError(err);
        }
      }, OPEN_TIMEOUT_MS);
      (openTimer as unknown as { unref?: () => void }).unref?.();

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        this.onAuthed();
        resolve();
      };
      const settleReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        this.authWaiter = null;
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        if (!isReconnect) reject(err);
        else {
          this.emitError(err);
          this.scheduleReconnect();
          reject(err);
        }
      };

      sock.onopen = () => {
        if (this.sock !== sock) return;
        void this.authenticate(sock).then(settleResolve, settleReject);
      };
      sock.onmessage = (data: string) => {
        if (this.sock !== sock) return;
        this.lastActivityAt = Date.now();
        const waiter = this.authWaiter;
        if (waiter) {
          const first =
            data
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.length > 0) ?? '';
          this.authWaiter = null;
          waiter(first);
          return;
        }
        for (const line of data.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) this.emit('message', trimmed);
        }
      };
      sock.onclose = () => {
        if (this.sock !== sock) return;
        this.sock = null;
        this.connected = false;
        this.stopLiveness();
        this.authWaiter = null;
        this.emit('close');
        if (!settled) {
          settleReject(new Error('relay: closed during auth'));
          return;
        }
        if (!this.explicitClose && !this.disposed && this.everAuthed) this.scheduleReconnect();
      };
      sock.onerror = (err: unknown) => {
        if (this.sock !== sock) return;
        if (!settled) {
          settleReject(err instanceof Error ? err : new Error(`relay: socket error: ${String(err)}`));
          return;
        }
        this.emitError(err);
      };
    });
  }

  private async authenticate(sock: RelaySocket): Promise<void> {
    const hello: Record<string, unknown> = { type: 'hello', pubkey: this.identity.publicKeyB64 };
    if (this.pendingRoom.roomId) hello.room_id = this.pendingRoom.roomId;
    if (this.pendingRoom.roomMeta) hello.room_meta = this.pendingRoom.roomMeta;

    const challengeRaw = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authWaiter = null;
        reject(new Error('relay auth timeout'));
      }, AUTH_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
      this.authWaiter = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
      sock.send(JSON.stringify(hello));
    });

    let challenge: { type?: string; nonce?: string; code?: string; message?: string };
    try {
      challenge = JSON.parse(challengeRaw) as typeof challenge;
    } catch {
      throw new Error(`relay auth_failed: not JSON: ${challengeRaw}`);
    }
    if (challenge.type === 'error') {
      if (challenge.code === 'room_already_open') throw new RoomAlreadyOpenError(this.pendingRoom.roomId);
      throw new Error(`relay rejected hello: ${challenge.code || challenge.message || 'unknown'}`);
    }
    if (challenge.type !== 'challenge' || !challenge.nonce) {
      throw new Error(`relay auth_failed: expected challenge, got ${challengeRaw}`);
    }
    const nonce = Buffer.from(challenge.nonce, 'base64');
    const sig = ed25519Sign(this.identity, nonce);
    sock.send(JSON.stringify({ type: 'auth', sig: sig.toString('base64') }));
    // No explicit OK on the wire — the relay simply starts routing.
  }

  private onAuthed(): void {
    this.connected = true;
    this.everAuthed = true;
    this.backoffAttempt = 0;
    this.lastActivityAt = Date.now();
    this.startLiveness();
    this.emit('open');
  }

  // ── Reconnect + liveness ───────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.disposed || this.explicitClose || !this.everAuthed) return;
    this.clearReconnect();
    const delay = RECONNECT_BACKOFFS_MS[Math.min(this.backoffAttempt, RECONNECT_BACKOFFS_MS.length - 1)];
    this.backoffAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.explicitClose) return;
      void this.dial(true).catch(() => {
        /* errors surface via 'error' + next backoff inside dial */
      });
    }, delay);
    (this.reconnectTimer as unknown as { unref?: () => void }).unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startLiveness(): void {
    this.stopLiveness();
    this.livenessTimer = setInterval(() => {
      if (Date.now() - this.lastActivityAt > LIVENESS_TIMEOUT_MS) {
        this.stopLiveness();
        try {
          this.sock?.close();
        } catch {
          /* close handler drives reconnect */
        }
      }
    }, LIVENESS_CHECK_MS);
    (this.livenessTimer as unknown as { unref?: () => void }).unref?.();
  }

  private stopLiveness(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private emitError(err: unknown): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}
