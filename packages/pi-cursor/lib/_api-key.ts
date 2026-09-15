/**
 * pi-cursor - API key resolution
 *
 * Source precedence, highest first:
 *   1. the key pi resolved for this request (auth.json, written by `/login cursor`)
 *   2. `CURSOR_API_KEY`
 *
 * This module never writes a key anywhere, never prints one, and never caches
 * one in module state beyond the single call that asked for it. pi owns the
 * on-disk copy at `~/.pi/agent/auth.json` (mode 0600), exactly like every other
 * provider; `@cursor/sdk`'s own `~/.cursor/sdk/auth.json` is never used.
 */

import { CURSOR_API_KEY_ENV, CURSOR_API_KEY_PLACEHOLDER, CURSOR_PROVIDER_ID } from './_types.ts';

export type KeyEnv = Record<string, string | undefined>;

/** Values that mean "nothing was configured" rather than a real key. */
function isPlaceholder(value: string): boolean {
  return (
    value === CURSOR_API_KEY_PLACEHOLDER ||
    value === CURSOR_API_KEY_ENV ||
    value === `$${CURSOR_API_KEY_ENV}` ||
    value === `\${${CURSOR_API_KEY_ENV}}`
  );
}

/** Trim a candidate key, rejecting blanks and the registration sentinel. */
export function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || isPlaceholder(trimmed)) {
    return undefined;
  }

  return trimmed;
}

/** `CURSOR_API_KEY` from the environment, if it holds a real value. */
export function readEnvApiKey(env: KeyEnv = process.env): string | undefined {
  return normalizeApiKey(env[CURSOR_API_KEY_ENV]);
}

/**
 * Read the key pi stored for the `cursor` provider.
 *
 * Imported lazily so that loading this module (and therefore the unit tests)
 * never pulls in the coding-agent bundle.
 */
export async function readStoredApiKey(authPath?: string): Promise<string | undefined> {
  try {
    const { readStoredCredential } = await import('@earendil-works/pi-coding-agent');
    const credential = readStoredCredential(CURSOR_PROVIDER_ID, authPath);

    return credential?.type === 'api_key' ? normalizeApiKey(credential.key) : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolveApiKeyOptions {
  /** Key pi already resolved for this request, when available. */
  explicit?: unknown;
  /** Override for tests; defaults to `process.env`. */
  env?: KeyEnv;
  /** Override for tests; skip the auth.json read when false. */
  allowStored?: boolean;
  /** Override for tests. */
  authPath?: string;
}

/**
 * Resolve the API key for a request. Returns `undefined` when nothing is
 * configured, which callers must treat as "not authenticated" rather than as
 * an error to log.
 */
export async function resolveCursorApiKey(options: ResolveApiKeyOptions = {}): Promise<string | undefined> {
  const explicit = normalizeApiKey(options.explicit);

  if (explicit) {
    return explicit;
  }

  const fromEnv = readEnvApiKey(options.env ?? process.env);

  if (fromEnv) {
    return fromEnv;
  }

  if (options.allowStored === false) {
    return undefined;
  }

  return readStoredApiKey(options.authPath);
}

/**
 * Name of the source a key came from, for status output. Never returns the key.
 */
export async function describeApiKeySource(
  options: ResolveApiKeyOptions = {}
): Promise<'request' | 'environment' | 'stored' | 'none'> {
  if (normalizeApiKey(options.explicit)) {
    return 'request';
  }

  if (readEnvApiKey(options.env ?? process.env)) {
    return 'environment';
  }

  if (options.allowStored === false) {
    return 'none';
  }

  return (await readStoredApiKey(options.authPath)) ? 'stored' : 'none';
}
