/**
 * pi-lyceum - API key handling
 *
 * The key has exactly one source: pi's credential store, written by
 * `/login lyceum` into `~/.pi/agent/auth.json` (mode 0600). This package reads
 * it for one purpose only, the manual `/lyceum-models` refresh; every chat turn
 * gets its key from pi, which resolves the same stored credential.
 *
 * The key is never written, never logged and never cached in module state, and
 * the only string this module can show a user is the masked form.
 */

import type { Credential } from '@earendil-works/pi-ai';
import { LYCEUM_PROVIDER_ID } from './_types.ts';

/**
 * Trim a candidate key and reject blanks and non-strings.
 *
 * @param value - Raw value from a credential or a prompt.
 * @returns The trimmed key, or `undefined` when nothing usable was supplied.
 */
export function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

/**
 * Render a key for display without revealing it.
 *
 * Short values are fully masked: showing four of six characters would leave
 * almost nothing hidden.
 *
 * @param key - The API key.
 * @returns A masked label such as `lk_…a91f (48 chars)`.
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();

  if (trimmed.length < 16) {
    return `••… (${trimmed.length} chars)`;
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (${trimmed.length} chars)`;
}

/**
 * Read the Lyceum key pi stored.
 *
 * The coding-agent import is lazy so loading this module (and therefore the
 * unit tests) never pulls in the host bundle, and a host that does not export
 * the reader degrades to "no key" instead of breaking the extension.
 *
 * @param authPath - Override for tests; defaults to pi's `auth.json`.
 * @returns The stored key, or `undefined` when none is configured.
 */
export async function readStoredLyceumApiKey(authPath?: string): Promise<string | undefined> {
  try {
    const { readStoredCredential } = await import('@earendil-works/pi-coding-agent');
    const credential: Credential | undefined =
      authPath === undefined
        ? readStoredCredential(LYCEUM_PROVIDER_ID)
        : readStoredCredential(LYCEUM_PROVIDER_ID, authPath);

    return credential?.type === 'api_key' ? normalizeApiKey(credential.key) : undefined;
  } catch {
    return undefined;
  }
}
