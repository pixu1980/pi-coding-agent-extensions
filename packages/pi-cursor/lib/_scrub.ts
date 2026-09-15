/**
 * pi-cursor - secret scrubbing
 *
 * Any string that can reach the terminal, a log, a session entry, or the LLM
 * passes through here first. The goal is narrow and testable: given the API key
 * in use, no output may contain it, and common credential carriers (Bearer
 * headers, `api_key=...`, cookies, URL userinfo) are redacted even when the key
 * is unknown to us.
 */

const REDACTED = "[redacted]";

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Redact credential-looking spans that do not require knowing the key. */
export function scrubCredentialShapes(text: string): string {
  return (
    text
    // scheme://user:password@host -> scheme://[redacted]@host
      .replaceAll(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@(?=[^\s/?#]+)/gi, `$1${REDACTED}@`)
      .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
      .replaceAll(/((?:^|[\s,{])cookie["']?\s*[:=]\s*["']?)[^\n]+/gi, `$1${REDACTED}`)
      .replaceAll(
        /((?:authorization|api[_-]?key|apiKey|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi,
        `$1${REDACTED}`,
      )
  );
}

/**
 * Scrub a string for display. `apiKey` is optional but should always be passed
 * when known: it lets us redact the exact key even when it appears bare.
 */
export function scrubSecrets(text: string, apiKey?: string): string {
  const trimmedKey = apiKey?.trim();
  const withoutKey = trimmedKey ? text.replaceAll(new RegExp(escapeRegExp(trimmedKey), "g"), REDACTED) : text;

  return scrubCredentialShapes(withoutKey);
}

/** Reduce a secret to a recognizable, non-reversible label for diagnostics. */
export function maskApiKey(apiKey: string | undefined): string {
  const trimmed = apiKey?.trim();

  if (!trimmed) {
    return "(none)";
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}…(${trimmed.length} chars)`;
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-2)} (${trimmed.length} chars)`;
}

/** Normalize a thrown value into a scrubbed single-line message. */
export function scrubError(error: unknown, apiKey?: string): string {
  if (error === undefined || error === null) {
    return "unknown error";
  }

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
          try {
            const json = JSON.stringify(error);

            return typeof json === "string" ? json : String(error);
          } catch {
            return String(error);
          }
        })();

  return scrubSecrets(raw, apiKey).replaceAll(/\s+/g, " ").trim() || "unknown error";
}
