/**
 * pi-remote - Phase 1 tests (identity, peer store, relay handshake, pairing)
 *
 * Run via the index.test.mjs barrel: node --import tsx --test __tests__/index.test.mjs
 *
 * All relay tests run against an in-process fake socket — no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import piRemoteExtension from '../index.ts';
import { ed25519Sign, ed25519Verify, identityPath, loadOrCreateIdentity } from '../lib/_identity.ts';
import { addPeer, findPeer, loadPeers, removePeer } from '../lib/_peers.ts';
import { RelayClient, RoomAlreadyOpenError } from '../lib/_relay.ts';
import { createMockPi, createMockCtx } from '../../../test/harness.mjs';

// ── Helpers ──────────────────────────────────────────────────────────

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'pi-remote-'));
}

const tick = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

/** In-process RelaySocket stand-in that plays the auth handshake. */
class FakeSocket {
  constructor(url, opts = {}) {
    this.url = url;
    this.sent = [];
    this.lastNonceB64 = null;
    this.helloReply = opts.helloReply ?? null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.closed = false;
    queueMicrotask(() => {
      if (!this.closed) this.onopen?.();
    });
  }

  send(data) {
    this.sent.push(data);
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      const reply = this.helloReply ?? { type: 'challenge', nonce: randomBytes(32).toString('base64') };
      if (reply.type === 'challenge') this.lastNonceB64 = reply.nonce;
      queueMicrotask(() => {
        if (!this.closed) this.onmessage?.(JSON.stringify(reply));
      });
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }

  receive(line) {
    this.onmessage?.(line);
  }
}

function pwaIdentity() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = Buffer.from(spki.subarray(spki.length - 32));
  return { peerId: raw.toString('base64') };
}

function pairRequestOuter(peerId, token, deviceName = 'Test Phone') {
  const inner = { type: 'pair_request', id: 'req-1', token, device_name: deviceName };
  return JSON.stringify({ peer: peerId, ct: Buffer.from(JSON.stringify(inner)).toString('base64') });
}

function sentOuters(sock) {
  return sock.sent
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((msg) => msg && typeof msg.ct === 'string');
}

function decodeInner(outer) {
  return JSON.parse(Buffer.from(outer.ct, 'base64').toString('utf8'));
}

// ── Identity ─────────────────────────────────────────────────────────

test('identity is stable across loads and locked to 0600', () => {
  const home = makeHome();
  const first = loadOrCreateIdentity(home);
  const second = loadOrCreateIdentity(home);
  assert.equal(second.publicKeyB64, first.publicKeyB64);
  assert.equal(first.publicKeyB64.length, 44); // 32 bytes, std base64 + padding
  const mode = statSync(identityPath(home)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('identity sign/verify roundtrip', () => {
  const home = makeHome();
  const id = loadOrCreateIdentity(home);
  const msg = Buffer.from('relay-nonce-bytes');
  const sig = ed25519Sign(id, msg);
  assert.equal(sig.length, 64);
  assert.ok(ed25519Verify(id.publicKeyRaw, msg, sig));
  assert.ok(!ed25519Verify(id.publicKeyRaw, Buffer.from('tampered'), sig));
});

// ── Peer store ───────────────────────────────────────────────────────

test('peer store add/find/remove persists atomically', () => {
  const home = makeHome();
  assert.deepEqual(loadPeers(home), []);
  addPeer(home, { name: 'Phone', remote_epk: 'abc=', paired_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(findPeer(home, 'abc=')?.name, 'Phone');
  // Re-adding same epk replaces instead of duplicating.
  addPeer(home, { name: 'Phone 2', remote_epk: 'abc=', paired_at: '2026-01-02T00:00:00.000Z' });
  assert.equal(loadPeers(home).length, 1);
  assert.equal(findPeer(home, 'abc=')?.name, 'Phone 2');
  assert.ok(removePeer(home, 'abc='));
  assert.ok(!removePeer(home, 'abc='));
  assert.deepEqual(loadPeers(home), []);
  // Corrupt file reads as empty instead of throwing.
  writeFileSync(join(home, 'peers.json'), '{not json');
  assert.deepEqual(loadPeers(home), []);
});

// ── Relay handshake ──────────────────────────────────────────────────

test('relay handshake sends hello/auth with a valid signature', async () => {
  const home = makeHome();
  const identity = loadOrCreateIdentity(home);
  let sock = null;
  const client = new RelayClient('wss://relay.test', identity, {
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  try {
    await client.connect({ roomId: 'room12345678' });
    assert.ok(client.isConnected());

    const hello = JSON.parse(sock.sent[0]);
    assert.equal(hello.type, 'hello');
    assert.equal(hello.pubkey, identity.publicKeyB64);
    assert.equal(hello.room_id, 'room12345678');

    const auth = JSON.parse(sock.sent.find((l) => JSON.parse(l).type === 'auth'));
    const nonce = Buffer.from(sock.lastNonceB64, 'base64');
    const sig = Buffer.from(auth.sig, 'base64');
    assert.ok(ed25519Verify(identity.publicKeyRaw, nonce, sig));

    // Cross-check with node:crypto directly (proves relay-compat primitives).
    const pub = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), identity.publicKeyRaw]),
      format: 'der',
      type: 'spki',
    });
    assert.ok(verify(null, nonce, pub, sig));
  } finally {
    client.dispose();
  }
});

test('relay splits JSONL frames into single message events', async () => {
  const home = makeHome();
  const identity = loadOrCreateIdentity(home);
  let sock = null;
  const client = new RelayClient('wss://relay.test', identity, {
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  const received = [];
  client.on('message', (line) => received.push(line));
  try {
    await client.connect({});
    sock.receive('{"a":1}\n{"b":2}\n');
    assert.deepEqual(received, ['{"a":1}', '{"b":2}']);
  } finally {
    client.dispose();
  }
});

test('relay maps room_already_open to RoomAlreadyOpenError', async () => {
  const home = makeHome();
  const identity = loadOrCreateIdentity(home);
  const client = new RelayClient('wss://relay.test', identity, {
    socketFactory: (url) => new FakeSocket(url, { helloReply: { type: 'error', code: 'room_already_open' } }),
  });
  try {
    await assert.rejects(client.connect({ roomId: 'duproom12345' }), (err) => {
      assert.ok(err instanceof RoomAlreadyOpenError);
      assert.equal(err.roomId, 'duproom12345');
      return true;
    });
    assert.ok(!client.isConnected());
  } finally {
    client.dispose();
  }
});

test('send before connect throws (callers drop frames)', () => {
  const home = makeHome();
  const identity = loadOrCreateIdentity(home);
  const client = new RelayClient('wss://relay.test', identity, {
    socketFactory: (url) => new FakeSocket(url),
  });
  try {
    assert.throws(() => client.send('{"peer":"x","ct":"e30="}'), /not connected/);
  } finally {
    client.dispose();
  }
});

// ── Over-relay pairing ───────────────────────────────────────────────

async function startPairedExtension(home, deviceName = 'Test Phone') {
  const { pi, runCommand, calls } = createMockPi();
  let sock = null;
  const api = piRemoteExtension(pi, {
    homeDir: home,
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  const pairedEvents = [];
  pi.events.on('pi-remote:paired', (ev) => pairedEvents.push(ev));

  await runCommand('pi-remote', 'start', ctx);
  assert.equal(api.getState(), 'started');
  assert.ok(sock, 'relay socket opened on start');

  await runCommand('pi-remote', 'pair', ctx);
  const message = calls.sendUserMessage.at(-1)[0];
  const token = /Manual token fallback.*: (\S+)/.exec(message)?.[1];
  assert.ok(token, 'pair message carries a manual token');

  return { api, runCommand, calls, sock, token, deviceName, pairedEvents };
}

test('pair_request with live token → pair_ok, peer stored, state paired', async () => {
  const home = makeHome();
  const { api, sock, token, deviceName, pairedEvents } = await startPairedExtension(home);
  try {
    const { peerId } = pwaIdentity();
    sock.receive(pairRequestOuter(peerId, token, deviceName));
    await tick();

    const replies = sentOuters(sock).filter((o) => o.peer === peerId);
    assert.equal(replies.length, 1);
    const inner = decodeInner(replies[0]);
    assert.equal(inner.type, 'pair_ok');
    assert.equal(inner.in_reply_to, 'req-1');
    assert.equal(inner.session_name, 'pi');
    assert.equal(typeof inner.room_id, 'string');
    assert.equal(inner.harness?.name, 'pi-remote');

    const stored = findPeer(home, peerId);
    assert.equal(stored?.name, deviceName);
    assert.equal(api.getState(), 'paired');
    assert.equal(pairedEvents.length, 1);
    assert.equal(pairedEvents[0].peerId, peerId);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('direct token consume pairs without relay round-trip', async () => {
  const home = makeHome();
  const { api, runCommand, token } = await startPairedExtension(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    assert.equal(api.consumePairToken(token), 'ok');
    assert.equal(api.getState(), 'paired');
    // Success clears the pairing session: the token is gone, not "consumed".
    assert.equal(api.consumePairToken(token), 'unknown');
    await runCommand('pi-remote', 'stop', ctx);
    assert.equal(api.getState(), 'idle');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('pair_request with stale token → pair_error token_unknown, stays started', async () => {
  const home = makeHome();
  const { api, runCommand, sock, deviceName } = await startPairedExtension(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    const { peerId } = pwaIdentity();
    sock.receive(pairRequestOuter(peerId, 'not-a-real-token', deviceName));
    await tick();

    const replies = sentOuters(sock).filter((o) => o.peer === peerId);
    assert.equal(replies.length, 1);
    const inner = decodeInner(replies[0]);
    assert.equal(inner.type, 'pair_error');
    assert.equal(inner.code, 'token_unknown');
    assert.equal(api.getState(), 'started');
    assert.equal(loadPeers(home).length, 0);

    await runCommand('pi-remote', 'stop', ctx);
    assert.equal(api.getState(), 'idle');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('non-pair message from unknown peer → unknown_peer error', async () => {
  const home = makeHome();
  const { api, sock } = await startPairedExtension(home);
  try {
    const { peerId } = pwaIdentity();
    const outer = { peer: peerId, ct: Buffer.from(JSON.stringify({ type: 'ping' })).toString('base64') };
    sock.receive(JSON.stringify(outer));
    await tick();

    const replies = sentOuters(sock).filter((o) => o.peer === peerId);
    assert.equal(replies.length, 1);
    assert.equal(decodeInner(replies[0]).code, 'unknown_peer');
    assert.equal(api.getState(), 'started');
  } finally {
    api.getRelay()?.dispose();
  }
});
