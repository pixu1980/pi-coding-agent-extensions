/**
 * pi-remote - Web Push sender (RFC 8291 aes128gcm + RFC 8292 VAPID)
 *
 * Zero dependencies: ECDH/HKDF/AES-GCM/ES256 all come from `node:crypto`.
 * Correctness is pinned to the RFC 8291 §5/Appendix A "watermelon" vector
 * (see `__tests__/_phase3.test.mjs`) — byte-identical output against a
 * real push service's expectations, not just a self-consistent round-trip.
 *
 * Privacy model: payloads are content-free wake-ups (`{kind:'wake-up', rm}`).
 * The push service sees timing, length and the subscription URI, never the
 * conversation. Subscription data itself travels the relay inside `ct`
 * (base64, not E2E) — same trust as everything else on that channel.
 */

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  randomBytes,
} from 'node:crypto';

export interface PushSubscriptionWire {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface VapidKeyMaterial {
  /** base64url uncompressed P-256 point (65 bytes, 0x04 prefix). */
  publicKey: string;
  /** base64url PKCS#8 DER private key. */
  privateKey: string;
}

export interface SendPushOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  fetchFn?: typeof fetch;
  vapidSubject?: string;
  vapidExpiresInSec?: number;
}

/** base64url encode (no padding). Tolerates Buffer/Uint8Array. */
export function b64urlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString('base64url');
}

/** base64url decode; also accepts std-base64 and missing padding. */
export function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/\+/g, '-').replace(/\//g, '_'), 'base64url');
}

/** Parses + validates an inbound subscription; throws Error on any defect. */
export function parseSubscription(raw: unknown): PushSubscriptionWire {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('subscription must be an object');
  const endpoint = (raw as Record<string, unknown>).endpoint;
  const keys = (raw as Record<string, unknown>).keys;
  if (typeof endpoint !== 'string') throw new Error('subscription.endpoint must be a string');
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('subscription.endpoint is not a URL');
  }
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  ) {
    throw new Error('subscription.endpoint must be https (http only for localhost tests)');
  }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('subscription.keys must be an object');
  const p256dh = (keys as Record<string, unknown>).p256dh;
  const auth = (keys as Record<string, unknown>).auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string')
    throw new Error('subscription.keys.p256dh/auth must be strings');
  const pub = b64urlDecode(p256dh);
  if (pub.length !== 65 || pub[0] !== 0x04)
    throw new Error('subscription.keys.p256dh must be a 65-byte uncompressed P-256 point');
  // Validates curve membership eagerly (fail fast, before any network use).
  try {
    createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(1)]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    throw new Error('subscription.keys.p256dh is not a valid P-256 point');
  }
  if (b64urlDecode(auth).length !== 16) throw new Error('subscription.keys.auth must be 16 bytes');
  return { endpoint, keys: { p256dh, auth } };
}

// ── RFC 8291 §3 key schedule ──────────────────────────────────────────

export interface ContentKeys {
  salt: Buffer;
  asPublicRaw: Buffer;
  cek: Buffer;
  nonce: Buffer;
}

function hmac(key: Uint8Array, ...parts: Uint8Array[]): Buffer {
  const h = createHmac('sha256', Buffer.from(key));
  for (const p of parts) h.update(Buffer.from(p));
  return h.digest();
}

/**
 * Derives CEK + nonce. Fixed `senderPrivateRaw`/`salt` exist for the RFC
 * vector test; production passes neither (fresh ephemeral key + salt).
 */
export function deriveContentKeys(opts: {
  uaPublicRaw: Uint8Array;
  authSecret: Uint8Array;
  senderPrivateRaw?: Uint8Array;
  salt?: Uint8Array;
}): ContentKeys {
  const ecdh = createECDH('prime256v1');
  if (opts.senderPrivateRaw) ecdh.setPrivateKey(Buffer.from(opts.senderPrivateRaw));
  else ecdh.generateKeys();
  const asPublicRaw = Buffer.from(ecdh.getPublicKey());
  const ecdhSecret = ecdh.computeSecret(Buffer.from(opts.uaPublicRaw));

  const prkKey = hmac(opts.authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info', 'ascii'),
    Buffer.from([0x00]),
    Buffer.from(opts.uaPublicRaw),
    asPublicRaw,
  ]);
  const ikm = hmac(prkKey, keyInfo, Buffer.from([0x01]));

  const salt = opts.salt ? Buffer.from(opts.salt) : randomBytes(16);
  const prk = hmac(salt, ikm);
  const cekInfo = Buffer.concat([Buffer.from('Content-Encoding: aes128gcm', 'ascii'), Buffer.from([0x00])]);
  const nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce', 'ascii'), Buffer.from([0x00])]);
  return {
    salt,
    asPublicRaw,
    cek: hmac(prk, cekInfo, Buffer.from([0x01])).subarray(0, 16),
    nonce: hmac(prk, nonceInfo, Buffer.from([0x01])).subarray(0, 12),
  };
}

export interface EncryptedPush {
  body: Buffer;
  salt: Buffer;
  asPublicRaw: Buffer;
}

/**
 * Encrypts one record (RFC 8188 §2 + RFC 8291 §4: single record,
 * 0x02 padding delimiter, no extra padding).
 */
export function encryptPushMessage(opts: {
  uaPublicRaw: Uint8Array;
  authSecret: Uint8Array;
  plaintext: Uint8Array;
  senderPrivateRaw?: Uint8Array;
  salt?: Uint8Array;
  recordSize?: number;
}): EncryptedPush {
  const recordSize = opts.recordSize ?? 4096;
  const { salt, asPublicRaw, cek, nonce } = deriveContentKeys(opts);
  const framed = Buffer.concat([Buffer.from(opts.plaintext), Buffer.from([0x02])]);
  if (framed.length + 16 > recordSize) {
    throw new Error(`plaintext too large for record size ${recordSize}`);
  }
  const header = Buffer.concat([
    salt,
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(recordSize, 0);
      return b;
    })(),
    Buffer.from([asPublicRaw.length]),
    asPublicRaw,
  ]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(framed), cipher.final(), cipher.getAuthTag()]);
  return { body: Buffer.concat([header, ciphertext]), salt, asPublicRaw };
}

// ── RFC 8292 VAPID ────────────────────────────────────────────────────

/** Converts a DER ECDSA signature to raw R||S (64 bytes). */
export function derToRawEs256(der: Uint8Array): Buffer {
  const b = Buffer.from(der);
  let o = 0;
  if (b[o++] !== 0x30) throw new Error('bad DER signature');
  const len = b[o++];
  if (len & 0x80) o += len & 0x7f;
  if (b[o++] !== 0x02) throw new Error('bad DER signature');
  const rLen = b[o++];
  let r = b.subarray(o, o + rLen);
  o += rLen;
  if (b[o++] !== 0x02) throw new Error('bad DER signature');
  const sLen = b[o++];
  let s = b.subarray(o, o + sLen);
  while (r.length > 32 && r[0] === 0x00) r = r.subarray(1);
  while (s.length > 32 && s[0] === 0x00) s = s.subarray(1);
  if (r.length > 32 || s.length > 32) throw new Error('bad DER signature');
  return Buffer.concat([Buffer.alloc(32 - r.length, 0), r, Buffer.alloc(32 - s.length, 0), s]);
}

export function signVapidJwt(opts: {
  vapidPrivatePkcs8B64: string;
  audience: string;
  subject: string;
  expiresInSec?: number;
  nowSec?: number;
}): string {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(
    Buffer.from(JSON.stringify({ aud: opts.audience, exp: now + (opts.expiresInSec ?? 43200), sub: opts.subject }))
  );
  const privateKey = createPrivateKey({ key: b64urlDecode(opts.vapidPrivatePkcs8B64), format: 'der', type: 'pkcs8' });
  const signer = createSign('sha256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const der = signer.sign(privateKey);
  return `${header}.${payload}.${b64urlEncode(derToRawEs256(der))}`;
}

/** Verifies a VAPID JWT against the SPKI DER of the VAPID public key. */
export function verifyVapidJwt(jwt: string, vapidPublicSpkiDer: Uint8Array, nowSec?: number): Record<string, unknown> {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) throw new Error('malformed JWT');
  const publicKey = createPublicKey({ key: Buffer.from(vapidPublicSpkiDer), format: 'der', type: 'spki' });
  // JWT carries raw R||S (RFC 7515 App. A); Node verifies DER by default.
  const ok = createVerify('sha256')
    .update(`${h}.${p}`)
    .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, b64urlDecode(s));
  if (!ok) throw new Error('bad JWT signature');
  const payload = JSON.parse(Buffer.from(b64urlDecode(p)).toString('utf8')) as Record<string, unknown>;
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('JWT expired');
  return payload;
}

// ── Send ──────────────────────────────────────────────────────────────

export interface PushResult {
  ok: boolean;
  status: number;
  /** True when the subscription is dead and must be dropped (404/410). */
  dead: boolean;
}

/**
 * Encrypts + POSTs one push message. Throws on invalid subscription or
 * network failure (caller decides retry); 4xx/5xx resolve with ok:false.
 */
export async function sendPush(
  subscription: PushSubscriptionWire,
  vapid: VapidKeyMaterial,
  payload: Uint8Array,
  opts: SendPushOptions = {}
): Promise<PushResult> {
  const sub = parseSubscription(subscription);
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('no fetch available');

  const { body } = encryptPushMessage({
    uaPublicRaw: b64urlDecode(sub.keys.p256dh),
    authSecret: b64urlDecode(sub.keys.auth),
    plaintext: payload,
  });
  const audience = new URL(sub.endpoint).origin;
  const jwt = signVapidJwt({
    vapidPrivatePkcs8B64: vapid.privateKey,
    audience,
    subject: opts.vapidSubject ?? 'mailto:pi-remote@localhost',
    expiresInSec: opts.vapidExpiresInSec ?? 43200,
  });

  const res = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(opts.ttl ?? 3600),
      Urgency: opts.urgency ?? 'normal',
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body: new Uint8Array(body),
  });
  const status = res.status;
  return { ok: status >= 200 && status < 300, status, dead: status === 404 || status === 410 };
}
