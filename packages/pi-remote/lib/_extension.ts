/**
 * pi-remote - extension entry (factory)
 *
 * Web-based remote control for the pi coding agent. State machine:
 * idle → started → paired, driven by `/pi-remote start|pair|stop|status`.
 *
 * Phase 0: local state + web pairing URL + token lifecycle.
 * Phase 1: relay WebSocket (Ed25519 challenge-response) + peer store +
 *   over-relay pairing (`pair_request` → token check → `pair_ok`/`pair_error`).
 * Phase 2: chat (`user_message` echo + streaming + history/sync), `ping`,
 *   `cancel`, and the ask_user bridge (pi-ask events → phone modals).
 * Phase 3: VAPID push delivery.
 * Phase 4: peer revoke, device listing, audit log, self-host docs.
 * See docs/plans/pi-remote-analisi.md.
 */

import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { buildPairUrl, clampPairTtlMs, QRSession, roomIdFor, TOKEN_TTL_MS } from './_pairing.ts';
import { loadOrCreateIdentity, piRemoteDir } from './_identity.ts';
import { addPeer, findPeer, loadPeers, removePeer } from './_peers.ts';
import { appendAudit, shortPeer } from './_audit.ts';
import { RelayClient, RoomAlreadyOpenError, type SocketFactory } from './_relay.ts';
import { ChatSession } from './_chat.ts';
import { createAskBridge, type AskBridge } from './_ask.ts';
import {
  buildWakeUpPayload,
  loadOrCreateVapidKeys,
  pushToSubscribers,
  removeSubscription,
  setSubscription,
  type VapidKeys,
} from './_push.ts';
import type { ClientMessage, ServerMessage } from './_protocol.ts';

type RemoteState = 'idle' | 'started' | 'paired';

const DEFAULT_RELAY_URL = 'wss://relay-rp1.jacobmoura.work';
const DEFAULT_PWA_URL = 'https://pixu1980.github.io/pi-remote';

export function relayUrl(): string {
  return process.env.PI_REMOTE_RELAY_URL ?? DEFAULT_RELAY_URL;
}

export function pwaUrl(): string {
  return process.env.PI_REMOTE_PWA_URL ?? DEFAULT_PWA_URL;
}

export interface PiRemoteDeps {
  socketFactory?: SocketFactory;
  homeDir?: string;
  fetchFn?: typeof fetch;
}

/** Outer envelope routed by the relay: `{peer, ct: base64(JSON inner)}`. */
interface OuterEnvelope {
  peer?: string;
  ct?: string;
}

type PairErrorCode = 'token_expired' | 'token_consumed' | 'token_unknown' | 'internal_error';

function readPackageVersion(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    const pkgPath = join(dirname(here), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function decodeInner(line: string): { peer: string; inner: Record<string, unknown> } | null {
  let outer: OuterEnvelope;
  try {
    outer = JSON.parse(line) as OuterEnvelope;
  } catch {
    return null;
  }
  if (!outer.peer || !outer.ct) return null;
  try {
    const inner = JSON.parse(Buffer.from(outer.ct, 'base64').toString('utf8')) as unknown;
    if (!inner || typeof inner !== 'object' || typeof (inner as Record<string, unknown>).type !== 'string') {
      return null;
    }
    return { peer: outer.peer, inner: inner as Record<string, unknown> };
  } catch {
    return null;
  }
}

function encodeOuter(peer: string, inner: Record<string, unknown>): string {
  return JSON.stringify({ peer, ct: Buffer.from(JSON.stringify(inner)).toString('base64') });
}

export default function piRemoteExtension(pi: ExtensionAPI, deps: PiRemoteDeps = {}) {
  const homeDir = deps.homeDir ?? piRemoteDir();
  let state: RemoteState = 'idle';
  const qr = new QRSession();
  let pairingTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionName = 'pi';
  let relay: RelayClient | null = null;
  let roomId = '';
  let piPubkeyB64 = '';
  let lastAbort: (() => void) | null = null;
  let vapidKeys: VapidKeys | null = null;
  const activePeers = new Set<string>();
  const sessionStartedAt = Date.now();
  const extensionVersion = readPackageVersion();
  const host = hostname();

  function audit(event: Parameters<typeof appendAudit>[1]['event'], detail?: string, peer?: string): void {
    appendAudit(homeDir, {
      ts: new Date().toISOString(),
      event,
      ...(peer ? { peer: shortPeer(peer) } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  /** Fire-and-forget wake-up push (content-free) to subscribed phones. */
  function pushWake(kind: 'done' | 'ask' | 'error'): void {
    if (!vapidKeys) return;
    const policy =
      kind === 'ask' || kind === 'error'
        ? { ttl: 600, urgency: 'high' as const }
        : { ttl: 3600, urgency: 'normal' as const };
    void pushToSubscribers(buildWakeUpPayload(roomId), {
      dir: homeDir,
      vapid: vapidKeys,
      fetchFn: deps.fetchFn,
      ...policy,
    }).then(
      (results) => {
        for (const r of results) {
          if (r.ok) audit('wake_push', `${kind}${r.dropped ? ' (dropped)' : ''}`, r.peer);
        }
      },
      () => {
        /* fan-out never throws; belt and suspenders */
      }
    );
  }

  function pushWakeForBroadcast(msg: ServerMessage): void {
    if (msg.type === 'agent_done') pushWake('done');
    else if (msg.type === 'extension_ui_request' && (msg.method === 'select' || msg.method === 'input'))
      pushWake('ask');
    else if (msg.type === 'error' && msg.code === 'provider_error') pushWake('error');
  }

  // ── Chat + ask bridge (wired once, live for the factory lifetime) ──
  const chat = new ChatSession(
    pi,
    {
      sendTo: (peer, msg) => {
        try {
          relay?.send(encodeOuter(peer, msg as unknown as Record<string, unknown>));
        } catch {
          /* relay down — drop frame; the PWA re-syncs on next open */
        }
      },
      peers: () => [...activePeers],
    },
    {
      sessionStartedAt,
      askPending: () => askBridge?.pendingRequests() ?? [],
      uiRespond: (msg) => askBridge?.respond(msg),
      abortTurn: () => {
        if (!lastAbort) throw new Error('no command context yet');
        lastAbort();
      },
      pushSubscribe: (peer, subscription) => {
        setSubscription(homeDir, peer, subscription);
        audit('push_subscribe', undefined, peer);
      },
      pushUnsubscribe: (peer) => {
        removeSubscription(homeDir, peer);
        audit('push_unsubscribe', undefined, peer);
      },
      onBroadcasted: (msg) => pushWakeForBroadcast(msg),
    }
  );
  chat.install();

  const askBridge: AskBridge | null = createAskBridge(
    (pi as { events?: Parameters<typeof createAskBridge>[0] }).events ?? null,
    (msg: ServerMessage) => {
      for (const peer of activePeers) {
        try {
          relay?.send(encodeOuter(peer, msg as unknown as Record<string, unknown>));
        } catch {
          /* relay down — sync replay recovers */
        }
      }
      pushWakeForBroadcast(msg);
    }
  );

  function clearPairing(): void {
    qr.clear();
    if (pairingTimer) {
      clearTimeout(pairingTimer);
      pairingTimer = null;
    }
  }

  function sendInner(peer: string, inner: Record<string, unknown>): void {
    // Best-effort: a mid-reconnect socket drops the frame instead of
    // crashing pi; the PWA re-syncs on next open (session_sync).
    try {
      relay?.send(encodeOuter(peer, inner));
    } catch {
      /* relay down — drop frame */
    }
  }

  function handlePairRequest(peer: string, inner: Record<string, unknown>): void {
    const id = typeof inner.id === 'string' ? inner.id : '';
    const token = typeof inner.token === 'string' ? inner.token : '';
    const deviceName = typeof inner.device_name === 'string' && inner.device_name ? inner.device_name : 'phone';

    const sendError = (code: PairErrorCode, message: string) => {
      sendInner(peer, { type: 'pair_error', in_reply_to: id, code, message });
    };

    const status = qr.consumeToken(token);
    if (status !== 'ok') {
      const code: PairErrorCode =
        status === 'expired' ? 'token_expired' : status === 'consumed' ? 'token_consumed' : 'token_unknown';
      const message =
        code === 'token_expired'
          ? 'Pairing token expired. Run /pi-remote pair again for a fresh token.'
          : code === 'token_consumed'
            ? 'Token already consumed by another pair_request.'
            : 'Token was not issued by this Pi.';
      sendError(code, message);
      audit('pair_reject', code, peer);
      return;
    }

    const pairedAt = new Date().toISOString();
    try {
      addPeer(homeDir, { name: deviceName, remote_epk: peer, paired_at: pairedAt });
    } catch (err) {
      sendError('internal_error', `Failed to persist peer: ${String(err)}`);
      return;
    }

    clearPairing();
    activePeers.add(peer);
    state = 'paired';
    sendInner(peer, {
      type: 'pair_ok',
      in_reply_to: id,
      session_name: sessionName,
      session_started_at: sessionStartedAt,
      room_id: roomId,
      harness: { name: 'pi-remote', version: extensionVersion },
      hostname: host,
      ...(vapidKeys ? { vapid_public_key: vapidKeys.publicKey } : {}),
    });
    audit('pair', deviceName, peer);
    pi.events.emit('pi-remote:paired', { name: deviceName, peerId: peer, pairedAt });
  }

  function installAutoListener(client: RelayClient): void {
    client.on('message', (line: string) => {
      if (state !== 'started' && state !== 'paired') return;
      const decoded = decodeInner(line);
      if (!decoded) return;
      const { peer, inner } = decoded;

      // Live channel: Phase 2 chat routing (prompt, sync, ping, cancel, ask answers).
      if (activePeers.has(peer)) {
        chat.route(peer, inner as unknown as ClientMessage);
        return;
      }
      if (inner.type === 'pair_request') {
        handlePairRequest(peer, inner);
        return;
      }
      if (findPeer(homeDir, peer)) {
        // Reconnect path: known peer, no live channel yet.
        activePeers.add(peer);
        state = 'paired';
        // Route the triggering message so the sender gets a reply.
        chat.route(peer, inner as unknown as ClientMessage);
        return;
      }
      sendInner(peer, { type: 'error', code: 'unknown_peer', message: 'Peer not paired — re-run /pi-remote pair' });
    });
  }

  async function start(cwd: string): Promise<string> {
    if (state !== 'idle') return `pi-remote is already ${state}.`;
    const identity = loadOrCreateIdentity(homeDir);
    piPubkeyB64 = identity.publicKeyB64;
    vapidKeys = loadOrCreateVapidKeys(homeDir);
    roomId = roomIdFor(cwd);
    try {
      sessionName = pi.getSessionName() || sessionName;
    } catch {
      /* harness without session name — keep default */
    }
    const client = new RelayClient(relayUrl(), identity, { socketFactory: deps.socketFactory });
    try {
      await client.connect({ roomId, roomMeta: { name: sessionName, cwd } });
    } catch (err) {
      client.dispose();
      if (err instanceof RoomAlreadyOpenError) {
        audit('relay_disconnect', `room_already_open:${roomId}`);
        return `Relay refused: this room is already open for this machine (${roomId}). Stop the other session or re-run /pi-remote stop first.`;
      }
      audit('relay_disconnect', `connect_failed:${err instanceof Error ? err.message : String(err)}`);
      return `Could not reach the relay (${relayUrl()}): ${err instanceof Error ? err.message : String(err)}`;
    }
    relay = client;
    activePeers.clear();
    installAutoListener(client);
    state = 'started';
    audit('start', roomId);
    audit('relay_connect', roomId);
    return `pi-remote started (room ${roomId}). Run /pi-remote pair to link your phone.`;
  }

  function pair(ttlArg?: string): string {
    if (state === 'idle') return 'Run /pi-remote start first.';
    const ttlMs = clampPairTtlMs(ttlArg ? Number(ttlArg) * 1000 : TOKEN_TTL_MS);
    const { token, expiresAt } = qr.issueToken(ttlMs);
    const url = buildPairUrl(pwaUrl(), token, roomId, sessionName, piPubkeyB64);

    if (pairingTimer) clearTimeout(pairingTimer);
    pairingTimer = setTimeout(clearPairing, ttlMs);
    (pairingTimer as unknown as { unref?: () => void }).unref?.();

    const seconds = Math.round((expiresAt - Date.now()) / 1000);
    return [
      'Open this URL on your phone (or scan it as a QR — rendered by the PWA docs site):',
      url,
      `Manual token fallback (expires in ~${seconds}s, single use): ${token}`,
      `Room: ${roomId}. No app install needed — add the page to your home screen for notifications.`,
    ].join('\n');
  }

  function stop(): string {
    clearPairing();
    relay?.dispose();
    relay = null;
    activePeers.clear();
    chat.clearTurn();
    state = 'idle';
    audit('stop');
    audit('relay_disconnect', 'stop');
    return 'pi-remote stopped.';
  }

  function devices(): string {
    const peers = loadPeers(homeDir);
    if (peers.length === 0) return 'No paired devices. Run /pi-remote pair to link one.';
    const lines = peers.map((p) => `  ${p.name}  [${shortPeer(p.remote_epk)}]  paired ${p.paired_at}`);
    return [`Paired devices (${peers.length}):`, ...lines, 'Revoke with: /pi-remote revoke <id-or-name>.'].join('\n');
  }

  function revoke(arg: string): string {
    const query = arg.trim();
    if (!query) return 'Usage: /pi-remote revoke <id-or-name>. See /pi-remote devices.';
    const lower = query.toLowerCase();
    const matches = loadPeers(homeDir).filter((p) => p.remote_epk.startsWith(query) || p.name.toLowerCase() === lower);
    if (matches.length === 0) return `No paired device matching "${query}". See /pi-remote devices.`;
    if (matches.length > 1) {
      const list = matches.map((p) => `${p.name} [${shortPeer(p.remote_epk)}]`).join(', ');
      return `Ambiguous match — ${matches.length} devices: ${list}. Use a longer id.`;
    }
    const peer = matches[0]!;
    const removed = removePeer(homeDir, peer.remote_epk);
    // A revoked device must lose every lever: stored subscription and any
    // live channel (with an explicit `bye` so the PWA can explain itself).
    removeSubscription(homeDir, peer.remote_epk);
    const wasActive = activePeers.delete(peer.remote_epk);
    if (wasActive) sendInner(peer.remote_epk, { type: 'bye', reason: 'revoked' });
    if (state === 'paired' && activePeers.size === 0) state = 'started';
    audit('revoke', peer.name, peer.remote_epk);
    return removed
      ? `Revoked ${peer.name} [${shortPeer(peer.remote_epk)}]. It must pair again to reconnect.`
      : `Device ${peer.name} was already revoked.`;
  }

  function status(): string {
    const peers = loadPeers(homeDir).length;
    return `pi-remote state: ${state} (relay ${relayUrl()}, room ${roomId || '—'}, ${peers} paired peer${peers === 1 ? '' : 's'}).`;
  }

  pi.registerCommand('pi-remote', {
    description: 'Control pi from your phone browser (PWA, no App Store): start|pair|stop|status|devices|revoke',
    handler: async (args, ctx) => {
      // Freshest command ctx wins for phone-initiated cancel (abort).
      const abort = (ctx as unknown as { abort?: unknown }).abort;
      if (typeof abort === 'function') lastAbort = abort.bind(ctx);

      const trimmed = (args ?? '').trim();
      const sep = trimmed.indexOf(' ');
      const action = (sep === -1 ? trimmed : trimmed.slice(0, sep)).toLowerCase() || 'status';
      // Keep the full remainder so device names with spaces survive.
      const rest = sep === -1 ? '' : trimmed.slice(sep + 1).trim();
      const cwd = (ctx as unknown as { cwd?: string }).cwd ?? process.cwd();

      let message: string;
      let toAgent = true;
      switch (action) {
        case 'start':
          message = await start(cwd);
          break;
        case 'pair':
          message = pair(rest);
          break;
        case 'stop':
          message = stop();
          break;
        case 'status':
          message = status();
          break;
        case 'devices':
          message = devices();
          toAgent = false;
          break;
        case 'revoke':
          message = revoke(rest);
          toAgent = false;
          break;
        default:
          message = `Unknown subcommand "${action}". Use: /pi-remote start|pair|stop|status|devices|revoke.`;
          toAgent = false;
      }

      if (ctx.mode === 'tui') ctx.ui.notify(message, 'info');
      // Security bookkeeping stays in the terminal — never fed to the LLM.
      if (toAgent) await pi.sendUserMessage(message, { deliverAs: 'followUp' });
    },
  });

  return {
    getState: (): RemoteState => state,
    /** Test/peer hook: consume a pairing token directly (bypasses the relay). */
    consumePairToken: (token: string) => {
      const result = qr.consumeToken(token);
      if (result === 'ok') {
        clearPairing();
        state = 'paired';
      }
      return result;
    },
    /** Test hook: reach the live relay client (null when stopped). */
    getRelay: (): RelayClient | null => relay,
    /** Test hook: reach the chat session (history, turn id). */
    getChat: (): ChatSession => chat,
  };
}
