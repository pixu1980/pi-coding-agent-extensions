/**
 * pi-remote - push state (VAPID keys, subscriptions, fan-out)
 *
 * Phase 0 scaffold grew up: VAPID key generation + content-free wake-up
 * payloads live alongside the persisted keypair (`vapid.json`, 0600), the
 * per-peer subscription store (`push.json`), and the fan-out that delivers
 * wake-ups and drops dead (404/410) subscriptions. Crypto/send primitives
 * live in `_webpush.ts`.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { piRemoteDir } from './_identity.ts';
import {
  parseSubscription,
  sendPush,
  type PushSubscriptionWire,
  type SendPushOptions,
  type VapidKeyMaterial,
} from './_webpush.ts';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Generates a P-256 VAPID key pair (base64url, uncompressed public key). */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Last 65 bytes of the SPKI DER encoding are the uncompressed EC point.
  const rawPublic = publicKey.subarray(publicKey.length - 65);

  return {
    publicKey: Buffer.from(rawPublic).toString('base64url'),
    privateKey: Buffer.from(privateKey).toString('base64url'),
  };
}

export function vapidPath(dir: string = piRemoteDir()): string {
  return join(dir, 'vapid.json');
}

/** Loads the VAPID keypair, generating + persisting it on first run. */
export function loadOrCreateVapidKeys(dir: string = piRemoteDir()): VapidKeys {
  mkdirSync(dir, { recursive: true });
  const path = vapidPath(dir);
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { publicKey?: unknown; privateKey?: unknown };
    if (typeof raw.publicKey === 'string' && typeof raw.privateKey === 'string') {
      return { publicKey: raw.publicKey, privateKey: raw.privateKey };
    }
  } catch {
    /* missing or corrupt — generate fresh below */
  }
  const keys = generateVapidKeys();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, ...keys }));
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* non-POSIX fs — best effort */
  }
  return keys;
}

/** VAPID subject for the JWT `sub` claim (a contact URL/mailto). */
export function vapidSubject(): string {
  return process.env.PI_REMOTE_VAPID_SUBJECT ?? 'mailto:pi-remote@localhost';
}

/** Minimal wake-up payload: never carries message content (see DISCLOSURE). */
export function buildWakeUpPayload(roomId: string): string {
  return JSON.stringify({ kind: 'wake-up', rm: roomId, at: Date.now() });
}

// ── Subscription store (push.json) ────────────────────────────────────

export function pushStorePath(dir: string = piRemoteDir()): string {
  return join(dir, 'push.json');
}

export type SubscriptionMap = Record<string, PushSubscriptionWire>;

export function loadSubscriptions(dir: string = piRemoteDir()): SubscriptionMap {
  try {
    const raw = JSON.parse(readFileSync(pushStorePath(dir), 'utf8')) as { subscriptions?: unknown };
    if (
      !raw ||
      typeof raw.subscriptions !== 'object' ||
      raw.subscriptions === null ||
      Array.isArray(raw.subscriptions)
    ) {
      return {};
    }
    const out: SubscriptionMap = {};
    for (const [peer, sub] of Object.entries(raw.subscriptions as Record<string, unknown>)) {
      try {
        out[peer] = parseSubscription(sub);
      } catch {
        /* drop corrupt entries on read */
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveSubscriptions(dir: string, subs: SubscriptionMap): void {
  mkdirSync(dir, { recursive: true });
  const path = pushStorePath(dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, subscriptions: subs }, null, 2));
  renameSync(tmp, path);
}

/** Validates + stores a peer's subscription (replaces any previous one). */
export function setSubscription(dir: string, peer: string, raw: unknown): PushSubscriptionWire {
  const sub = parseSubscription(raw);
  const subs = loadSubscriptions(dir);
  subs[peer] = sub;
  saveSubscriptions(dir, subs);
  return sub;
}

/** Returns true when a subscription was actually removed. */
export function removeSubscription(dir: string, peer: string): boolean {
  const subs = loadSubscriptions(dir);
  if (!(peer in subs)) return false;
  delete subs[peer];
  saveSubscriptions(dir, subs);
  return true;
}

// ── Fan-out ───────────────────────────────────────────────────────────

export interface PushFanoutOptions extends SendPushOptions {
  dir?: string;
  vapid?: VapidKeyMaterial;
  /** Restrict delivery (default: every subscribed peer). */
  peers?: string[];
}

export interface PushFanoutResult {
  peer: string;
  ok: boolean;
  status: number;
  dropped: boolean;
}

/**
 * Sends a wake-up to subscribed peers; drops subscriptions the push
 * service reports dead (404/410). Never throws — per-peer failures are
 * reported in the result list.
 */
export async function pushToSubscribers(
  payload: Uint8Array | string,
  opts: PushFanoutOptions = {}
): Promise<PushFanoutResult[]> {
  const dir = opts.dir ?? piRemoteDir();
  const vapid = opts.vapid ?? loadOrCreateVapidKeys(dir);
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const subs = loadSubscriptions(dir);
  const targets = (opts.peers ?? Object.keys(subs)).filter((peer) => peer in subs);

  const results = await Promise.all(
    targets.map(async (peer): Promise<PushFanoutResult> => {
      try {
        const res = await sendPush(subs[peer] as PushSubscriptionWire, vapid, body, {
          ttl: opts.ttl,
          urgency: opts.urgency,
          fetchFn: opts.fetchFn,
          vapidSubject: opts.vapidSubject ?? vapidSubject(),
        });
        if (res.dead) removeSubscription(dir, peer);
        return { peer, ok: res.ok, status: res.status, dropped: res.dead };
      } catch {
        return { peer, ok: false, status: 0, dropped: false };
      }
    })
  );
  return results;
}
