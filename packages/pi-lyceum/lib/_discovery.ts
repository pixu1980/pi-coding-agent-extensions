/**
 * pi-lyceum - live model discovery
 *
 * The single place in this package that opens a connection: `GET /models` on
 * the Lyceum endpoint. Everything a chat turn sends is issued by pi's own
 * `openai-completions` implementation, not by this module.
 *
 * The request carries the user's API key and nothing else. Redirects are
 * refused, the final URL is checked against the allowlist, the body is capped,
 * and the whole call is bounded by a timeout that also honors pi's abort
 * signal, so a stalled endpoint cannot hold a refresh open forever.
 */

import { isAllowedLyceumUrl, isChatModelId } from './_catalog.ts';
import { LYCEUM_BASE_URL, LYCEUM_DISCOVERY_TIMEOUT_MS, LYCEUM_MAX_CATALOG_CHARS } from './_types.ts';

/** Minimal `fetch` shape, injectable so tests never open a socket. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Options accepted by {@link fetchLiveModelIds}. */
export interface FetchLiveModelIdsOptions {
  /** Lyceum API key, sent as the bearer credential. */
  apiKey: string;
  /** pi's cancellation signal, forwarded to the request. */
  signal?: AbortSignal;
  /** Override for tests; defaults to the platform `fetch`. */
  fetchImpl?: FetchLike;
  /** Override for tests; defaults to {@link LYCEUM_DISCOVERY_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Read the `error.message` field Lyceum returns for a failed request.
 *
 * @param text - Response body.
 * @returns The provider message, or `undefined` when the body has another shape.
 */
function errorMessageFrom(text: string): string | undefined {
  try {
    const payload: unknown = JSON.parse(text);

    if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
      return undefined;
    }

    const error = (payload as { error?: unknown }).error;

    if (typeof error !== 'object' || error === null || !('message' in error)) {
      return undefined;
    }

    const message = (error as { message?: unknown }).message;

    return typeof message === 'string' && message.trim() ? message.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turn a non-2xx response into an error that names the status and the provider
 * reason, without echoing headers or the request body.
 *
 * @param response - The failed response.
 * @returns The error to throw.
 */
async function describeFailure(response: Response): Promise<Error> {
  let message: string | undefined;

  try {
    const body = await response.text();
    message = errorMessageFrom(body);
  } catch {
    message = undefined;
  }

  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

  return new Error(`Lyceum model discovery failed: ${status}${message ? ` - ${message}` : ''}`);
}

/**
 * Read a response body while enforcing the size cap.
 *
 * @param response - The response to read.
 * @returns The body text.
 */
async function readCappedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));

  if (Number.isFinite(declared) && declared > LYCEUM_MAX_CATALOG_CHARS) {
    throw new Error(`Lyceum model discovery failed: response exceeds ${LYCEUM_MAX_CATALOG_CHARS} characters`);
  }

  const text = await response.text();

  if (text.length > LYCEUM_MAX_CATALOG_CHARS) {
    throw new Error(`Lyceum model discovery failed: response exceeds ${LYCEUM_MAX_CATALOG_CHARS} characters`);
  }

  return text;
}

/**
 * Extract model ids from an OpenAI-compatible model list.
 *
 * Only the documented shape is read: `{ "data": [{ "id": "..." }] }`. Entries
 * without a usable id are ignored rather than turned into placeholder models,
 * and ids that cannot answer a chat completion are dropped.
 *
 * @param text - Response body.
 * @returns Usable chat model ids, in response order, without duplicates.
 */
export function parseModelIds(text: string): string[] {
  const payload: unknown = JSON.parse(text);

  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    return [];
  }

  const data = (payload as { data?: unknown }).data;

  if (!Array.isArray(data)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of data) {
    const id =
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string'
          ? item.id
          : undefined;

    if (id === undefined) {
      continue;
    }

    const trimmed = id.trim();

    if (!isChatModelId(trimmed) || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    ids.push(trimmed);
  }

  return ids;
}

/**
 * List the model ids Lyceum currently serves.
 *
 * @param options - API key, cancellation signal and test overrides.
 * @returns Usable chat model ids.
 * @throws When the key is blank, the request fails, the response is oversized,
 *   unparsable, or arrives from a host outside the allowlist.
 */
export async function fetchLiveModelIds(options: FetchLiveModelIdsOptions): Promise<string[]> {
  const apiKey = options.apiKey.trim();

  if (!apiKey) {
    throw new Error('Lyceum model discovery needs an API key.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? LYCEUM_DISCOVERY_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = `${LYCEUM_BASE_URL}/models`;

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal,
  });

  if (!response.ok) {
    throw await describeFailure(response);
  }

  if (response.url && !isAllowedLyceumUrl(response.url)) {
    throw new Error('Lyceum model discovery failed: response came from a host outside the allowlist');
  }

  return parseModelIds(await readCappedBody(response));
}
