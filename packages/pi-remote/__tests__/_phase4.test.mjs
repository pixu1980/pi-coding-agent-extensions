/**
 * pi-remote - Phase 4 tests (audit log, device listing, peer revoke)
 *
 * Run via the index.test.mjs barrel: node --import tsx --test __tests__/index.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import piRemoteExtension from '../index.ts';
import { appendAudit, auditPath, readAudit, shortPeer } from '../lib/_audit.ts';
import { addPeer, loadPeers } from '../lib/_peers.ts';
import { loadSubscriptions, setSubscription } from '../lib/_push.ts';
import { b64urlEncode } from '../lib/_webpush.ts';
import { createMockPi, createMockCtx } from '../../../test/harness.mjs';

// ── Helpers ──────────────────────────────────────────────────────────

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'pi-remote-'));
}

const tick = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

class FakeSocket {
  constructor(url, opts = {}) {
    this.url = url;
    this.sent = [];
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

function pwaPeerId() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return Buffer.from(ecdh.getPublicKey()).toString('base64');
}

function outerTo(peerId, inner) {
  return JSON.stringify({ peer: peerId, ct: Buffer.from(JSON.stringify(inner)).toString('base64') });
}

function innersTo(sock, peerId) {
  return sock.sent
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((msg) => msg && msg.peer === peerId && typeof msg.ct === 'string')
    .map((msg) => JSON.parse(Buffer.from(msg.ct, 'base64').toString('utf8')));
}

/** ctx whose ui.notify is captured (devices/revoke are terminal-only). */
function noticeCtx(notices, cwd) {
  return createMockCtx({ cwd, ui: { notify: (message, type) => notices.push([message, type]) } });
}

async function startPaired(home, deviceName = 'Pixel') {
  const harness = createMockPi();
  const { pi, runCommand, calls } = harness;
  let sock = null;
  const api = piRemoteExtension(pi, {
    homeDir: home,
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  await runCommand('pi-remote', 'start', ctx);

  await runCommand('pi-remote', 'pair', ctx);
  const token = /Manual token fallback.*: (\S+)/.exec(calls.sendUserMessage.at(-1)[0])?.[1];
  assert.ok(token);
  const peerId = pwaPeerId();
  sock.receive(outerTo(peerId, { type: 'pair_request', id: 'req-1', token, device_name: deviceName }));
  await tick();
  assert.equal(innersTo(sock, peerId).at(-1)?.type, 'pair_ok');
  return { ...harness, api, sock, ctx, peerId };
}

function pushSub() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: 'https://push.example.net/push/x',
    keys: { p256dh: b64urlEncode(Buffer.from(ecdh.getPublicKey())), auth: b64urlEncode(randomBytes(16)) },
  };
}

// ── Audit ────────────────────────────────────────────────────────────

test('audit appends, reads back, and is locked to 0600', () => {
  const home = makeHome();
  appendAudit(home, { ts: '2026-01-01T00:00:00.000Z', event: 'start', detail: 'room' });
  appendAudit(home, { ts: '2026-01-01T00:00:01.000Z', event: 'pair', peer: 'abcd1234', detail: 'Phone' });
  const events = readAudit(home);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'start');
  assert.equal(events[1].peer, 'abcd1234');
  assert.equal(statSync(auditPath(home)).mode & 0o777, 0o600);
});

test('audit rotates one generation past the size cap', () => {
  const home = makeHome();
  writeFileSync(auditPath(home), `${'x'.repeat(600_000)}\n`);
  appendAudit(home, { ts: '2026-01-01T00:00:00.000Z', event: 'start' });
  assert.ok(existsSync(join(home, 'audit.1.jsonl')), 'previous generation kept');
  const events = readAudit(home);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'start');
});

test('audit never throws on a corrupt file', () => {
  const home = makeHome();
  writeFileSync(auditPath(home), '{not json\nstill not json\n');
  assert.deepEqual(readAudit(home), []);
  appendAudit(home, { ts: '2026-01-01T00:00:00.000Z', event: 'stop' });
  assert.equal(readAudit(home).length, 1);
});

test('shortPeer truncates to 8 chars', () => {
  assert.equal(shortPeer('abcdefghijklmnop'), 'abcdefgh');
  assert.equal(shortPeer('short'), 'short');
});

// ── Devices ──────────────────────────────────────────────────────────

test('devices lists paired peers and hints at revoke', async () => {
  const home = makeHome();
  const { api, runCommand } = await startPaired(home, 'Pixel');
  addPeer(home, { name: 'iPad', remote_epk: 'ZZZZ0000pad', paired_at: '2026-01-01T00:00:00.000Z' });
  try {
    const notices = [];
    await runCommand('pi-remote', 'devices', noticeCtx(notices, join(home, 'proj')));
    const text = notices.at(-1)?.[0] ?? '';
    assert.match(text, /Paired devices \(2\)/);
    assert.match(text, /Pixel/);
    assert.match(text, /iPad/);
    assert.match(text, /revoke <id-or-name>/);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('devices with no peers says so and stays out of the agent', async () => {
  const harness = createMockPi();
  piRemoteExtension(harness.pi, { homeDir: makeHome() });
  const notices = [];
  await harness.runCommand('pi-remote', 'devices', noticeCtx(notices, '/tmp'));
  assert.match(notices.at(-1)?.[0] ?? '', /No paired devices/);
  assert.equal(harness.calls.sendUserMessage.length, 0, 'terminal-only, never fed to the LLM');
});

// ── Revoke ───────────────────────────────────────────────────────────

test('revoke removes peer + subscription, sends bye, demotes state, audits', async () => {
  const home = makeHome();
  const { api, runCommand, sock, peerId } = await startPaired(home, 'Pixel');
  setSubscription(home, peerId, pushSub());
  try {
    assert.equal(api.getState(), 'paired');
    const notices = [];
    await runCommand('pi-remote', 'revoke Pixel', noticeCtx(notices, join(home, 'proj')));

    assert.match(notices.at(-1)?.[0] ?? '', /Revoked Pixel/);
    assert.equal(loadPeers(home).length, 0);
    assert.ok(!(peerId in loadSubscriptions(home)), 'push subscription dropped');
    const bye = innersTo(sock, peerId).at(-1);
    assert.equal(bye?.type, 'bye');
    assert.equal(bye?.reason, 'revoked');
    assert.equal(api.getState(), 'started');

    const revoked = readAudit(home).filter((e) => e.event === 'revoke');
    assert.equal(revoked.length, 1);
    assert.equal(revoked[0].peer, shortPeer(peerId));
  } finally {
    api.getRelay()?.dispose();
  }
});

test('revoke is terminal-only (never fed to the LLM)', async () => {
  const home = makeHome();
  const { api, runCommand, calls } = await startPaired(home, 'Pixel');
  try {
    const before = calls.sendUserMessage.length;
    await runCommand('pi-remote', 'revoke Pixel', noticeCtx([], join(home, 'proj')));
    assert.equal(calls.sendUserMessage.length, before);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('revoke by id prefix matches exactly one device', async () => {
  const harness = createMockPi();
  const home = makeHome();
  piRemoteExtension(harness.pi, { homeDir: home, socketFactory: () => new FakeSocket('wss://x') });
  addPeer(home, { name: 'A', remote_epk: 'abc111', paired_at: 'x' });
  addPeer(home, { name: 'B', remote_epk: 'xyz222', paired_at: 'x' });
  const notices = [];
  await harness.runCommand('pi-remote', 'revoke abc', noticeCtx(notices, home));
  assert.match(notices.at(-1)[0], /Revoked A \[abc111\]/);
  assert.deepEqual(
    loadPeers(home).map((p) => p.name),
    ['B']
  );
});

test('ambiguous and unknown revoke targets report clearly, mutate nothing', async () => {
  const harness = createMockPi();
  const home = makeHome();
  piRemoteExtension(harness.pi, { homeDir: home });
  addPeer(home, { name: 'A', remote_epk: 'abc111', paired_at: 'x' });
  addPeer(home, { name: 'B', remote_epk: 'abc222', paired_at: 'x' });

  const notices = [];
  await harness.runCommand('pi-remote', 'revoke ab', noticeCtx(notices, home));
  assert.match(notices.at(-1)[0], /Ambiguous match/);
  assert.equal(loadPeers(home).length, 2);

  await harness.runCommand('pi-remote', 'revoke nope', noticeCtx(notices, home));
  assert.match(notices.at(-1)[0], /No paired device matching/);
  assert.equal(loadPeers(home).length, 2);

  await harness.runCommand('pi-remote', 'revoke', noticeCtx(notices, home));
  assert.match(notices.at(-1)[0], /Usage: \/pi-remote revoke/);

  assert.equal(readAudit(home).filter((e) => e.event === 'revoke').length, 0, 'no audit on non-revokes');
});

// ── Lifecycle audit ──────────────────────────────────────────────────

test('pairing lifecycle lands in the audit log', async () => {
  const home = makeHome();
  const { api, peerId } = await startPaired(home, 'Pixel');
  try {
    const events = readAudit(home).map((e) => e.event);
    assert.ok(events.includes('start'));
    assert.ok(events.includes('relay_connect'));
    assert.ok(events.includes('pair'));
    const pair = readAudit(home).find((e) => e.event === 'pair');
    assert.equal(pair?.peer, shortPeer(peerId));
    assert.equal(pair?.detail, 'Pixel');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('a rejected pairing is audited with its error code', async () => {
  const home = makeHome();
  const { api, runCommand, calls, sock } = await startPaired(home, 'Pixel');
  try {
    await runCommand('pi-remote', 'pair', createMockCtx({ cwd: join(home, 'proj') }));
    const _token = /Manual token fallback.*: (\S+)/.exec(calls.sendUserMessage.at(-1)[0])?.[1];
    const intruder = pwaPeerId();
    sock.receive(outerTo(intruder, { type: 'pair_request', id: 'r-2', token: 'wrong-token', device_name: 'Eve' }));
    await tick();
    const reject = readAudit(home).filter((e) => e.event === 'pair_reject');
    assert.equal(reject.length, 1);
    assert.equal(reject[0].detail, 'token_unknown');
    assert.equal(reject[0].peer, shortPeer(intruder));
  } finally {
    api.getRelay()?.dispose();
  }
});
