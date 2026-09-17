/**
 * pi-remote PWA - relay client (vanilla JS, zero dependencies).
 *
 * Wire-compatible with the pi-remote / remote_pi relay:
 *   hello {pubkey std-base64, room_id} → challenge {nonce} → auth {sig}
 * then opaque outer envelopes {peer: dest, room: destRoom, ct} outbound and
 * {peer: sender, room: senderRoom, ct} inbound. `ct` is std-base64 JSON.
 *
 * Identity is a WebCrypto Ed25519 keypair (private JWK in localStorage).
 * Requires a secure context + a browser with WebCrypto Ed25519.
 */

'use strict';

function bytesToB64Std(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function b64StdToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function ed25519Supported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    !!window.crypto?.subtle
  );
}

/** Loads the phone identity, generating it on first run. */
export async function loadOrCreateIdentity() {
  const KEY = 'pi-remote.pwa-key';
  const raw = localStorage.getItem(KEY);
  let privateKey = null;

  if (raw) {
    try {
      privateKey = await crypto.subtle.importKey('jwk', JSON.parse(raw), { name: 'Ed25519' }, true, ['sign']);
    } catch {
      privateKey = null;
    }
  }
  if (!privateKey) {
    let pair = null;
    try {
      pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    } catch (err) {
      throw new Error(`This browser cannot do Ed25519 (${err.message}). Use a current Chrome/Safari/Firefox over HTTPS.`);
    }
    privateKey = pair.privateKey;
    localStorage.setItem(KEY, JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey)));
  }

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', await publicKeyOf(privateKey)));
  const rawPub = spki.slice(spki.length - 32);
  const peerId = bytesToB64Std(rawPub);

  return {
    peerId,
    async sign(data) {
      const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data);
      return new Uint8Array(sig);
    },
  };
}

async function publicKeyOf(privateKey) {
  // WebCrypto cannot derive verify-from-sign directly; re-import via JWK x/d.
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  return crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, { name: 'Ed25519' }, true, ['verify']);
}

const AUTH_TIMEOUT_MS = 8000;

export class RelayClient {
  constructor(url, identity, { roomId } = {}) {
    this.url = url;
    this.identity = identity;
    this.roomId = roomId || 'main';
    this.ws = null;
    this.onOuter = null; // ({peer, room, inner}) => void
    this.onOpen = null;
    this.onClose = null;
    this.wantClose = false;
  }

  async connect() {
    this.wantClose = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay connect timeout')), AUTH_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('relay socket error'));
      };
    });

    const hello = { type: 'hello', pubkey: this.identity.peerId, room_id: this.roomId };
    ws.send(JSON.stringify(hello));
    const challenge = await this.nextLine();
    let parsed;
    try {
      parsed = JSON.parse(challenge);
    } catch {
      throw new Error('relay auth failed: not JSON');
    }
    if (parsed.type === 'error') throw new Error(`relay rejected hello: ${parsed.code || parsed.message || 'unknown'}`);
    if (parsed.type !== 'challenge' || !parsed.nonce) throw new Error('relay auth failed: expected challenge');
    const sig = await this.identity.sign(b64StdToBytes(parsed.nonce));
    ws.send(JSON.stringify({ type: 'auth', sig: bytesToB64Std(sig) }));
    // No explicit OK on the wire — the relay simply starts routing.

    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : '';
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || !this.onOuter) continue;
        let outer;
        try {
          outer = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!outer.peer || !outer.ct) continue;
        let inner;
        try {
          inner = JSON.parse(new TextDecoder().decode(b64StdToBytes(outer.ct)));
        } catch {
          continue;
        }
        if (!inner || typeof inner.type !== 'string') continue;
        this.onOuter({ peer: outer.peer, room: outer.room, inner });
      }
    };
    ws.onclose = () => this.onClose?.();
    ws.onerror = () => this.onClose?.();
    this.onOpen?.();
  }

  nextLine() {
    const ws = this.ws;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay auth timeout')), AUTH_TIMEOUT_MS);
      const onMsg = (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : '';
        const first = text.split('\n').map((l) => l.trim()).find((l) => l);
        if (!first) return;
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(first);
      };
      ws.addEventListener('message', onMsg);
    });
  }

  sendEnvelope(destPeer, destRoom, inner) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('relay not connected');
    const ct = bytesToB64Std(new TextEncoder().encode(JSON.stringify(inner)));
    this.ws.send(JSON.stringify({ peer: destPeer, room: destRoom, ct }));
  }

  close() {
    this.wantClose = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
