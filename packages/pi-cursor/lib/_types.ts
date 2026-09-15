/**
 * pi-cursor - shared constants and narrow types
 *
 * Everything here is pure data: no network, no filesystem, no pi imports.
 * Keeping the constants in one module lets the security tests assert on the
 * exact egress allowlist and provider identity without loading anything heavy.
 */

/** pi provider id. The stored credential lives under this key in auth.json. */
export const CURSOR_PROVIDER_ID = "cursor";

/** Display name shown by `/login` and `/model`. */
export const CURSOR_PROVIDER_NAME = "Cursor";

/**
 * API flavour tag. `Api` in pi-ai is an open union (`KnownApi | (string & {})`),
 * so a custom tag is legal and routes every model to our `streamSimple`.
 */
export const CURSOR_API_ID = "cursor-sdk";

/** Environment variable holding the API key, used as a fallback source. */
export const CURSOR_API_KEY_ENV = "CURSOR_API_KEY";

/**
 * Non-secret sentinel handed to pi's provider registry.
 *
 * pi treats a `$ENV_VAR` value as unconfigured when the variable is absent,
 * which would hide every Cursor model before the user logs in. Registering a
 * literal placeholder keeps the provider visible; the real key is resolved per
 * request in the stream path and never leaves the machine except as the
 * `Authorization` header sent to Cursor itself.
 */
export const CURSOR_API_KEY_PLACEHOLDER = "pi-cursor-api-key-placeholder";

/**
 * Hosts the extension (and the Cursor SDK it drives) may talk to.
 * Both are Cursor-owned. Anything else is a bug or an attack.
 */
export const CURSOR_EGRESS_ALLOWLIST = ["api.cursor.com", "api2.cursor.sh"] as const;

/**
 * Backend URL override read by the Cursor SDK.
 *
 * The SDK honours this variable internally. We never set it; we only refuse to
 * run when it points somewhere we do not trust, so a stray shell export cannot
 * silently redirect a user's API key to a third party.
 */
export const CURSOR_BACKEND_URL_ENV = "CURSOR_BACKEND_URL";

/** Opt-in escape hatch for the override guard (self-hosted Cursor stacks). */
export const CURSOR_ALLOW_BACKEND_OVERRIDE_ENV = "PI_CURSOR_ALLOW_BACKEND_OVERRIDE";

/** Env var that prints the audited egress surface at startup. */
export const CURSOR_EGRESS_LOG_ENV = "PI_CURSOR_LOG_EGRESS";

/** Model catalog cache filename under pi's agent dir. */
export const CURSOR_MODEL_CACHE_FILE = "pi-cursor-models.json";

/** Catalog cache schema version; bump to invalidate on shape changes. */
export const CURSOR_MODEL_CACHE_VERSION = 1;

/** How long a cached catalog stays fresh, in milliseconds (default: 6 hours). */
export const CURSOR_MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Conservative defaults used when the catalog does not describe a model. */
export const CURSOR_FALLBACK_CONTEXT_WINDOW = 128_000;
export const CURSOR_FALLBACK_MAX_TOKENS = 16_384;

/** Per-model cost placeholder. Cursor bills by subscription/usage, not per token here. */
export const CURSOR_ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/** Input modalities advertised for every Cursor model. */
export const CURSOR_MODEL_INPUT: ("text" | "image")[] = ["text", "image"];

/** Cap on the display-only activity trace emitted as thinking content. */
export const CURSOR_ACTIVITY_TRACE_MAX_CHARS = 20_000;
