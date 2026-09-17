/**
 * pi-remote - pairing session (web flavour)
 *
 * Adapted from remote_pi's `pi-extension/src/pairing/qr.ts`: same single-use
 * ephemeral token semantics (default 60 s TTL), but the QR payload is an
 * HTTPS URL pointing at the pi-remote PWA instead of a `remotepi://` deep
 * link, so no native app is required. A manual-token fallback is always
 * shown for phones whose camera opens the browser instead of an app.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Default ephemeral-token lifetime (also the QR rotation period). */
export const TOKEN_TTL_MS = 60_000;
/** Bounds for a caller-supplied pairing TTL (e.g. `/pi-remote pair 120`). */
export const PAIR_TTL_MIN_MS = 10_000;
export const PAIR_TTL_MAX_MS = 600_000;

/** Clamp an arbitrary ttl (ms) into the safe pairing range; NaN → default. */
export function clampPairTtlMs(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) return TOKEN_TTL_MS;
  return Math.min(PAIR_TTL_MAX_MS, Math.max(PAIR_TTL_MIN_MS, Math.floor(ttlMs)));
}

interface ActiveToken {
  token: string;
  expiresAt: number;
  consumed: boolean;
}

/** Encapsulates the single active pairing token. One instance per Pi process. */
export class QRSession {
  private active: ActiveToken | null = null;

  /** Generates a fresh 16-byte random token encoded as base64url. */
  generateToken(): string {
    return randomBytes(16).toString('base64url');
  }

  /**
   * Issues a new active token, invalidating any previous one.
   * Returns the token and its expiry timestamp.
   */
  issueToken(ttlMs: number = TOKEN_TTL_MS): { token: string; expiresAt: number } {
    const token = this.generateToken();
    const expiresAt = Date.now() + ttlMs;
    this.active = { token, expiresAt, consumed: false };
    return { token, expiresAt };
  }

  /** Validates and atomically consumes a token. */
  consumeToken(token: string): 'ok' | 'expired' | 'consumed' | 'unknown' {
    if (!this.active || this.active.token !== token) return 'unknown';
    if (this.active.consumed) return 'consumed';
    if (Date.now() > this.active.expiresAt) return 'expired';
    this.active.consumed = true;
    return 'ok';
  }

  clear(): void {
    this.active = null;
  }
}

/**
 * Builds the PWA pairing URL encoded in the QR shown in the terminal.
 * `baseUrl` is the publicly reachable PWA origin (Pages hosting, zero cost);
 * `roomId` multiplexes N pi processes sharing one relay connection;
 * `piPubkeyB64` is this machine's canonical Ed25519 id so the PWA knows
 * WHERE to send its `pair_request` (the relay routes outer envelopes by peer).
 */
export function buildPairUrl(
  baseUrl: string,
  token: string,
  roomId: string,
  sessionName: string,
  piPubkeyB64: string
): string {
  const params = new URLSearchParams({
    t: token,
    rm: roomId,
    n: sessionName.slice(0, 80),
    epk: piPubkeyB64,
  });
  return `${baseUrl.replace(/\/+$/, '')}/pair?${params.toString()}`;
}

/**
 * Derives the 12-char room id from the working directory, mirroring
 * remote_pi's `rooms.ts` so relays stay compatible.
 */
export function roomIdFor(cwd: string): string {
  return createHash('sha256').update(cwd).digest('base64url').slice(0, 12);
}
