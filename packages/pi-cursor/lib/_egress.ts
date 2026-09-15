/**
 * pi-cursor - egress policy
 *
 * The extension makes zero network calls of its own: every request is issued
 * by the Cursor SDK, and the SDK only ever talks to Cursor's own backend. This
 * module states that policy explicitly so it can be asserted in tests and
 * surfaced to the user, and it closes the one footgun the SDK leaves open: a
 * `CURSOR_BACKEND_URL` override, which would otherwise redirect the user's API
 * key to an arbitrary host without any prompt.
 */

import {
  CURSOR_ALLOW_BACKEND_OVERRIDE_ENV,
  CURSOR_BACKEND_URL_ENV,
  CURSOR_EGRESS_ALLOWLIST,
} from "./_types.ts";

export type EgressEnv = Record<string, string | undefined>;

/** True when `hostname` is a Cursor-owned endpoint we are willing to reach. */
export function isAllowedCursorHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

  return (CURSOR_EGRESS_ALLOWLIST as readonly string[]).some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`),
  );
}

/**
 * Accepts what the SDK accepts, a bare origin or a full URL, and reports
 * whether it stays inside the allowlist. Malformed values are never allowed:
 * a value we cannot parse is a value we cannot vouch for.
 */
export function isAllowedCursorEndpoint(value: string | URL | undefined): boolean {
  return parseEndpoint(value) !== undefined;
}

function parseEndpoint(value: string | URL | undefined): URL | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof URL) {
    return value.protocol === "https:" && isAllowedCursorHost(value.hostname) ? value : undefined;
  }

  const raw = value.trim();

  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);

    return url.protocol === "https:" && isAllowedCursorHost(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Throws unless the URL points at a Cursor-owned HTTPS endpoint. */
export function assertAllowedCursorEndpoint(value: string | URL): URL {
  const url = parseEndpoint(value);

  if (!url) {
    throw new Error(
      `Refusing to contact ${JSON.stringify(String(value))}: pi-cursor only talks to ${CURSOR_EGRESS_ALLOWLIST.join(", ")}.`,
    );
  }

  return url;
}

export interface BackendOverrideCheck {
  /** True when the process may proceed. */
  ok: boolean;
  /** The raw override value, when one was set. */
  override?: string;
  /** Why the override was rejected, when it was. */
  reason?: string;
}

/**
 * Fail closed on `CURSOR_BACKEND_URL` unless it resolves inside the allowlist
 * or the user explicitly opted in.
 *
 * We cannot stop the SDK from reading the variable, so we refuse to hand it a
 * credential at all when the value is untrusted.
 */
export function checkBackendOverride(env: EgressEnv = process.env): BackendOverrideCheck {
  const override = env[CURSOR_BACKEND_URL_ENV]?.trim();

  if (!override) {
    return { ok: true };
  }

  if (isAllowedCursorEndpoint(override)) {
    return { ok: true, override };
  }

  if (env[CURSOR_ALLOW_BACKEND_OVERRIDE_ENV] === "1") {
    return {
      ok: true,
      override,
      reason: `${CURSOR_BACKEND_URL_ENV} points outside the allowlist but ${CURSOR_ALLOW_BACKEND_OVERRIDE_ENV}=1 was set by the user.`,
    };
  }

  return {
    ok: false,
    override,
    reason:
			`${CURSOR_BACKEND_URL_ENV}=${JSON.stringify(override)} is not a Cursor endpoint. ` +
			`pi-cursor refuses to send your API key there. Unset ${CURSOR_BACKEND_URL_ENV}, ` +
			`or set ${CURSOR_ALLOW_BACKEND_OVERRIDE_ENV}=1 if this is your own Cursor-compatible backend.`,
  };
}

export interface EgressSurface {
  /** Cursor-owned hosts the extension may reach. */
  hosts: readonly string[];
  /** Backend override state for the current process. */
  override: BackendOverrideCheck;
  /**
	 * HTTP clients owned by pi-cursor. Always empty: it ships none, so every
	 * request on the wire is the Cursor SDK's own, issued from the call sites
	 * listed below.
	 */
  extensionHttpClients: readonly string[];
  /** The Cursor SDK entry points pi-cursor drives, in order of occurrence. */
  sdkCallSites: readonly string[];
}

/** Cursor SDK entry points the extension triggers. */
export const CURSOR_SDK_CALL_SITES = [
  "Cursor.models.list(), model discovery",
  "Agent.create(), one local agent per pi session",
  "agent.send(), one run per turn",
] as const;

/** Machine-readable description of the outbound surface, for the status command. */
export function describeEgressSurface(env: EgressEnv = process.env): EgressSurface {
  return {
    hosts: CURSOR_EGRESS_ALLOWLIST,
    override: checkBackendOverride(env),
    extensionHttpClients: [],
    sdkCallSites: CURSOR_SDK_CALL_SITES,
  };
}

/** Multi-line, human-readable render of the outbound surface. */
export function formatEgressSurface(surface: EgressSurface = describeEgressSurface()): string {
  const lines = [
    "pi-cursor outbound surface",
    `- HTTP clients owned by pi-cursor: none`,
    `- requests allowed to: ${surface.hosts.join(", ")}`,
    "- Cursor SDK call sites pi-cursor triggers:",
    ...surface.sdkCallSites.map((site) => `    ${site}`),
    `- ${CURSOR_BACKEND_URL_ENV}: ${surface.override.override ? JSON.stringify(surface.override.override) : "(unset)"}`,
  ];

  if (!surface.override.ok) {
    lines.push(`- BLOCKED: ${surface.override.reason}`);
  } else if (surface.override.reason) {
    lines.push(`- note: ${surface.override.reason}`);
  }

  return lines.join("\n");
}
