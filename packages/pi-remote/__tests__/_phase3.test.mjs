/**
 * pi-remote - Phase 3 tests (Web Push: RFC vector, VAPID, fan-out)
 *
 * Run via the index.test.mjs barrel: node --import tsx --test __tests__/index.test.mjs
 *
 * Crypto correctness is pinned to RFC 8291 §5/Appendix A ("watermelon"):
 * byte-identical output, not just a self-consistent round-trip. A second,
 * independent decryptor below proves a real user agent could open what we
 * send with fresh random keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import piRemoteExtension from '../index.ts';
import {
  b64urlDecode,
  b64urlEncode,
  deriveContentKeys,
  derToRawEs256,
  encryptPushMessage,
  parseSubscription,
  sendPush,
  signVapidJwt,
  verifyVapidJwt,
} from '../lib/_webpush.ts';
import { generateVapidKeys, loadOrCreateVapidKeys, loadSubscriptions } from '../lib/_push.ts';
import { createMockPi, createMockCtx } from '../../../test/harness.mjs';

// ── RFC 8291 §5 / Appendix A vector ────────────────────────────────────
// https://www.rfc-editor.org/rfc/rfc8291.txt

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body: [
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml',
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT',
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  ].join(''),
};

test('RFC 8291 vector: derived CEK and nonce match Appendix A', () => {
  const keys = deriveContentKeys({
    uaPublicRaw: b64urlDecode(RFC.uaPublic),
    authSecret: b64urlDecode(RFC.auth),
    senderPrivateRaw: b64urlDecode(RFC.asPrivate),
    salt: b64urlDecode(RFC.salt),
  });
  assert.equal(b64urlEncode(keys.cek), RFC.cek);
  assert.equal(b64urlEncode(keys.nonce), RFC.nonce);
  assert.equal(b64urlEncode(keys.asPublicRaw), RFC.asPublic);
});

test('RFC 8291 vector: full encrypted body matches §5', () => {
  const { body } = encryptPushMessage({
    uaPublicRaw: b64urlDecode(RFC.uaPublic),
    authSecret: b64urlDecode(RFC.auth),
    plaintext: Buffer.from(RFC.plaintext, 'utf8'),
    senderPrivateRaw: b64urlDecode(RFC.asPrivate),
    salt: b64urlDecode(RFC.salt),
    recordSize: 4096,
  });
  assert.equal(b64urlEncode(body), RFC.body);
});

// ── Independent decryptor (stands in for a real user agent) ────────────

function testDecrypt(uaPrivateRaw, uaPublicRaw, authSecret, body) {
  const salt = body.subarray(0, 16);
  const keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen);
  const tagged = body.subarray(21 + keyLen);
  const h = (key, ...parts) => {
    const hh = createHmac('sha256', Buffer.from(key));
    for (const p of parts) hh.update(Buffer.from(p));
    return hh.digest();
  };
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivateRaw));
  const secret = ecdh.computeSecret(Buffer.from(asPublic));
  const prkKey = h(authSecret, secret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0]),
    Buffer.from(uaPublicRaw),
    asPublic,
  ]);
  const ikm = h(prkKey, keyInfo, Buffer.from([1]));
  const prk = h(salt, ikm);
  const cek = h(
    prk,
    Buffer.concat([Buffer.from('Content-Encoding: aes128gcm', 'ascii'), Buffer.from([0])]),
    Buffer.from([1])
  ).subarray(0, 16);
  const nonce = h(
    prk,
    Buffer.concat([Buffer.from('Content-Encoding: nonce', 'ascii'), Buffer.from([0])]),
    Buffer.from([1])
  ).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tagged.subarray(tagged.length - 16));
  const framed = Buffer.concat([decipher.update(tagged.subarray(0, tagged.length - 16)), decipher.final()]);
  assert.equal(framed[framed.length - 1], 0x02);
  return framed.subarray(0, framed.length - 1).toString('utf8');
}

test('fresh encryption round-trips through the independent decryptor', () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const uaPublicRaw = Buffer.from(ecdh.getPublicKey());
  const uaPrivateRaw = Buffer.from(ecdh.getPrivateKey());
  const authSecret = randomBytes(16);
  const { body } = encryptPushMessage({ uaPublicRaw, authSecret, plaintext: Buffer.from('ping', 'utf8') });
  assert.equal(testDecrypt(uaPrivateRaw, uaPublicRaw, authSecret, body), 'ping');
});

// ── VAPID ──────────────────────────────────────────────────────────────

test('VAPID JWT verifies against the public key with intact claims', () => {
  const vapid = generateVapidKeys();
  const jwt = signVapidJwt({
    vapidPrivatePkcs8B64: vapid.privateKey,
    audience: 'https://push.example.net',
    subject: 'mailto:test@example.net',
  });
  // P-256 SPKI prefix (91-byte DER = 26-byte header + 65-byte point).
  const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
  const spki = createPublicKey({
    key: Buffer.concat([Buffer.from(P256_SPKI_PREFIX, 'hex'), b64urlDecode(vapid.publicKey)]),
    format: 'der',
    type: 'spki',
  }).export({ format: 'der', type: 'spki' });
  const payload = verifyVapidJwt(jwt, spki);
  assert.equal(payload.aud, 'https://push.example.net');
  assert.equal(payload.sub, 'mailto:test@example.net');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));

  // Cross-check signature with node:crypto directly.
  const [h, p, s] = jwt.split('.');
  const ok = createVerify('sha256')
    .update(`${h}.${p}`)
    .verify({ key: spki, format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363' }, b64urlDecode(s));
  assert.ok(ok);

  // Tampered payload fails; expired fails.
  const bad = `${h}.${b64urlEncode(Buffer.from('{"aud":"x"}'))}.${s}`;
  assert.throws(() => verifyVapidJwt(bad, spki), /signature|expired/);
  const old = signVapidJwt({
    vapidPrivatePkcs8B64: vapid.privateKey,
    audience: 'https://push.example.net',
    subject: 'mailto:test@example.net',
    nowSec: Math.floor(Date.now() / 1000) - 100000,
  });
  assert.throws(() => verifyVapidJwt(old, spki), /expired/);
});

test('derToRawEs256 strips leading-zero padding', () => {
  // Hand-built DER: R = 00||0x80.. (33 bytes), S = 00||0x7f.. (33 bytes).
  const r = Buffer.concat([Buffer.from([0x00, 0x80]), Buffer.alloc(31, 0x11)]);
  const s = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0x22)]);
  const der = Buffer.concat([
    Buffer.from([0x30, 4 + r.length + s.length, 0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
  const raw = derToRawEs256(der);
  assert.equal(raw.length, 64);
  assert.equal(raw[0], 0x80);
  assert.equal(raw[1], 0x11);
  assert.equal(raw[32], 0x22);
  assert.equal(raw[33], 0x22);
});

test('VAPID keys persist per home dir', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-remote-'));
  const first = loadOrCreateVapidKeys(home);
  assert.equal(loadOrCreateVapidKeys(home).publicKey, first.publicKey);
  assert.equal(b64urlDecode(first.publicKey).length, 65);
});

// ── Subscription validation ────────────────────────────────────────────

test('parseSubscription accepts good shapes, rejects defects', () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const good = {
    endpoint: 'https://push.example.net/x',
    keys: { p256dh: b64urlEncode(Buffer.from(ecdh.getPublicKey())), auth: b64urlEncode(randomBytes(16)) },
  };
  assert.deepEqual(parseSubscription(good), good);
  assert.throws(() => parseSubscription({ ...good, endpoint: 'http://evil.test/x' }), /https/);
  assert.throws(() => parseSubscription({ ...good, keys: { p256dh: 'AAAA', auth: good.keys.auth } }), /65-byte/);
  assert.throws(() => parseSubscription({ ...good, keys: { p256dh: good.keys.p256dh, auth: 'AAAA' } }), /16 bytes/);
  assert.throws(() => parseSubscription(null), /object/);
});

// ── Extension fan-out ──────────────────────────────────────────────────

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

async function startPaired(home, fetchFn) {
  const harness = createMockPi();
  const { pi, runCommand, calls } = harness;
  let sock = null;
  const api = piRemoteExtension(pi, {
    homeDir: home,
    socketFactory: (url) => (sock = new FakeSocket(url)),
    fetchFn,
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  await runCommand('pi-remote', 'start', ctx);

  await runCommand('pi-remote', 'pair', ctx);
  const token = /Manual token fallback.*: (\S+)/.exec(calls.sendUserMessage.at(-1)[0])?.[1];
  assert.ok(token);
  const peerId = pwaPeerId();
  sock.receive(outerTo(peerId, { type: 'pair_request', id: 'req-1', token, device_name: 'Phone' }));
  await tick();
  assert.equal(innersTo(sock, peerId).at(-1)?.type, 'pair_ok');
  return { api, pi, emit: harness.emit, runCommand, sock, ctx, peerId };
}

function subscribePeer(sock, peerId, overrides = {}) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const uaPublicRaw = Buffer.from(ecdh.getPublicKey());
  const sub = {
    endpoint: 'https://push.example.net/push/sub-1',
    keys: { p256dh: b64urlEncode(uaPublicRaw), auth: b64urlEncode(randomBytes(16)) },
    ...overrides,
  };
  sock.receive(outerTo(peerId, { type: 'push_subscribe', id: 'ps-1', subscription: sub }));
  return { sub, uaPrivateRaw: Buffer.from(ecdh.getPrivateKey()), uaPublicRaw };
}

test('push_subscribe stores, replies push_ok; invalid rejected', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startPaired(home, async () => ({ ok: true, status: 201 }));
  try {
    const { sub } = subscribePeer(sock, peerId);
    await tick();
    assert.deepEqual(
      innersTo(sock, peerId).find((m) => m.type === 'push_ok'),
      { type: 'push_ok', in_reply_to: 'ps-1' }
    );
    assert.deepEqual(loadSubscriptions(home)[peerId], sub);

    sock.receive(outerTo(peerId, { type: 'push_subscribe', id: 'ps-2', subscription: { nope: true } }));
    await tick();
    const err = innersTo(sock, peerId).find((m) => m.in_reply_to === 'ps-2');
    assert.equal(err?.code, 'invalid_message');

    sock.receive(outerTo(peerId, { type: 'push_unsubscribe', id: 'ps-3' }));
    await tick();
    assert.ok(innersTo(sock, peerId).find((m) => m.type === 'push_ok' && m.in_reply_to === 'ps-3'));
    assert.ok(!(peerId in loadSubscriptions(home)));
  } finally {
    api.getRelay()?.dispose();
  }
});

test('agent_done pushes an encrypted wake-up (decryptable by the subscriber)', async () => {
  const home = makeHome();
  const posts = [];
  const fetchFn = async (url, init) => {
    posts.push({ url, headers: init.headers, body: Buffer.from(init.body) });
    return { ok: true, status: 201 };
  };
  const { api, emit, sock, peerId } = await startPaired(home, fetchFn);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    const { sub, uaPrivateRaw, uaPublicRaw } = subscribePeer(sock, peerId);
    await tick();

    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-1', text: 'go' }));
    await tick();
    await emit('agent_end', {}, ctx);
    await tick();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, sub.endpoint);
    assert.equal(posts[0].headers['Content-Encoding'], 'aes128gcm');
    assert.match(posts[0].headers.Authorization, /^vapid t=[^,]+, k=[A-Za-z0-9_-]+$/);
    assert.equal(posts[0].headers.Urgency, 'normal');

    const opened = testDecrypt(uaPrivateRaw, uaPublicRaw, b64urlDecode(sub.keys.auth), posts[0].body);
    const wake = JSON.parse(opened);
    assert.equal(wake.kind, 'wake-up');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('ask requests push with high urgency; 410 drops the subscription', async () => {
  const home = makeHome();
  const posts = [];
  let status = 201;
  const fetchFn = async (_url, init) => {
    posts.push({ headers: init.headers });
    return { ok: status >= 200 && status < 300, status };
  };
  const { api, pi, sock, peerId } = await startPaired(home, fetchFn);
  try {
    subscribePeer(sock, peerId);
    await tick();

    pi.events.emit('@eko24ive/pi-ask:started', {
      version: 1,
      flowId: 'flow-9',
      questions: [
        { id: 'q', label: 'Q', prompt: 'Pick', type: 'single', required: true, options: [{ value: 'a', label: 'A' }] },
      ],
    });
    await tick();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].headers.Urgency, 'high');

    status = 410;
    pi.events.emit('@eko24ive/pi-ask:started', {
      version: 1,
      flowId: 'flow-10',
      questions: [
        { id: 'q', label: 'Q', prompt: 'Pick', type: 'single', required: true, options: [{ value: 'a', label: 'A' }] },
      ],
    });
    await tick();
    assert.equal(posts.length, 2);
    assert.ok(!(peerId in loadSubscriptions(home)), 'dead subscription dropped');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('no subscription means no push traffic', async () => {
  const home = makeHome();
  let calls = 0;
  const { api, emit, sock, peerId } = await startPaired(home, async () => {
    calls += 1;
    return { ok: true, status: 201 };
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-2', text: 'go' }));
    await tick();
    await emit('agent_end', {}, ctx);
    await tick();
    assert.equal(calls, 0);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('pair_ok advertises the VAPID public key', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startPaired(home, async () => ({ ok: true, status: 201 }));
  try {
    const ok = innersTo(sock, peerId).find((m) => m.type === 'pair_ok');
    assert.ok(ok?.vapid_public_key);
    assert.equal(b64urlDecode(ok.vapid_public_key).length, 65);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('sendPush posts a valid VAPID + aes128gcm request', async () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = {
    endpoint: 'https://push.example.net/push/direct',
    keys: { p256dh: b64urlEncode(Buffer.from(ecdh.getPublicKey())), auth: b64urlEncode(randomBytes(16)) },
  };
  const vapid = generateVapidKeys();
  let seen;
  const res = await sendPush(sub, vapid, Buffer.from('hi'), {
    fetchFn: async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 201 };
    },
    ttl: 60,
    urgency: 'high',
    vapidSubject: 'mailto:t@t.t',
  });
  assert.deepEqual({ ok: res.ok, status: res.status, dead: res.dead }, { ok: true, status: 201, dead: false });
  assert.equal(seen.init.headers.TTL, '60');
  assert.equal(seen.init.headers.Urgency, 'high');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
});
