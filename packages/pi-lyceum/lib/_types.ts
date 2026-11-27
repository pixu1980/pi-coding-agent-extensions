/**
 * pi-lyceum - shared constants
 *
 * Pure data only: no network, no filesystem, no pi imports. Keeping provider
 * identity, the endpoint and every bound in one module lets the tests assert on
 * the exact egress surface without loading anything that could reach the
 * network.
 */

/** pi provider id. The credential pi stores lives under this key in auth.json. */
export const LYCEUM_PROVIDER_ID = 'lyceum';

/** Display name shown by `/login` and `/model`. */
export const LYCEUM_PROVIDER_NAME = 'Lyceum';

/**
 * pi-ai API implementation this provider delegates to.
 *
 * Lyceum serves an OpenAI-compatible Chat Completions API (streaming SSE, tool
 * calling, `reasoning_effort`, usage in the stream), so there is no reason to
 * carry a stream implementation of our own: pi's `openai-completions` API
 * converts the transcript, parses the stream and accounts usage for us.
 */
export const LYCEUM_API_ID = 'openai-completions';

/** OpenAI-compatible base URL for Lyceum serverless inference. */
export const LYCEUM_BASE_URL = 'https://api.lyceum.technology/openai/v1';

/**
 * The only hosts this package may talk to.
 *
 * `fetchLiveModelIds` refuses a response whose final URL is outside this list,
 * and redirects are refused outright, so an endpoint change cannot silently
 * move the user's API key to another host.
 */
export const LYCEUM_EGRESS_ALLOWLIST = ['api.lyceum.technology'] as const;

/**
 * Per-request output ceiling Lyceum documents. Larger `max_tokens` values are
 * rejected with a 400 that names the field, so the catalog never asks for more.
 */
export const LYCEUM_MAX_OUTPUT_TOKENS = 131_072;

/** Request timeout for `GET /models`, in milliseconds. */
export const LYCEUM_DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Cap on the catalog response body, in characters.
 *
 * `GET /models` returns a model list, not a conversation, so a megabyte is
 * already far beyond anything legitimate; the cap keeps a hostile or broken
 * endpoint from filling memory.
 */
export const LYCEUM_MAX_CATALOG_CHARS = 1_048_576;

/**
 * Context window assumed for a live model id that is not in the bundled
 * catalog. Lyceum's smallest documented chat window is 256K, but assuming a
 * smaller window only triggers compaction earlier, so 131072 is the safe side
 * of that guess.
 */
export const LYCEUM_UNKNOWN_CONTEXT_WINDOW = 131_072;

/** Output ceiling assumed for a live model id that is not in the bundled catalog. */
export const LYCEUM_UNKNOWN_MAX_TOKENS = 16_384;

/** Cost placeholder for a model whose price is not in the bundled catalog. */
export const LYCEUM_ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * pi thinking levels mapped onto Lyceum's `reasoning_effort` enum.
 *
 * The enum is `none | low | medium | high`. `off` is mapped explicitly because
 * reasoning is on by default on every Lyceum model that supports it: omitting
 * the field would leave thinking enabled instead of turning it off.
 */
export const LYCEUM_THINKING_LEVEL_MAP = {
  off: 'none',
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
} as const;

/**
 * OpenAI-compatibility flags for every Lyceum model.
 *
 * Only deviations from pi-ai's auto-detection are listed, and each one follows
 * what the endpoint documents: `max_tokens` (not `max_completion_tokens`),
 * `reasoning_effort` for thinking, usage inside the stream. `store` and the
 * `developer` role are not documented, so they stay off and pi sends a
 * `system` message instead.
 */
export const LYCEUM_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  maxTokensField: 'max_tokens',
  thinkingFormat: 'openai',
} as const;

/** Command that refreshes the live catalog without restarting pi. */
export const LYCEUM_REFRESH_COMMAND = 'lyceum-models';
