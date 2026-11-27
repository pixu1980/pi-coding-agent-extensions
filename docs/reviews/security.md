# security review

- **Role**: security v2
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. Whole repository: ten packages, the root and the published registry state.

Status: `complete`.

Findings distilled from [the audit](../audits/security.md). Each row cites an audit section.

## Lens coverage

| Lens | Findings | Verdict |
| ---- | -------- | ------- |
| Input validation, size caps and ReDoS. | SEC-02, SEC-06 | Fails in one place. pi-web caps bytes, time and redirects. pi-remote caps nothing inbound. |
| Secrets handling and where they land on disk. | SEC-05 | Mostly passes. Five writers set `0o600`. MCP traces do not. |
| Trust boundary between repo content and agent instructions. | SEC-07 | Partly passes. MCP consent exists. Fetched pages carry no data boundary. |
| What the server fetches at runtime, and what verifies it. | SEC-01, SEC-02, SEC-06 | Fails. No address pinning, four range gaps, and a third-party relay by default. |
| Error path that leaks more than it reports. | SEC-06 | Fails on one path. pi-remote returns raw error text to the phone. |

## Decisions taken on this run

| Question | Decision | Consumed by |
| -------- | -------- | ----------- |
| How to close the pi-web SSRF gaps? | Block the four transition prefixes and pin the validated IP. | SEC-01, SEC-02 |
| How to fix the pi-cursor advisories? | Bump `@cursor/sdk`, add overrides, then release. | SEC-03 |
| pi-mcp cannot be republished. What then? | Advisory only, naming the advisories and the replacement. | SEC-04 |
| Where should MCP traces live? | Agent directory, mode `0o600`, sensitive fields redacted. | SEC-05 |
| What happens to pi-remote? | Delete the package and unpublish both versions from npm. | SEC-06 |
| pi-remote inbound caps and error redaction? | Moot. The package goes away. | SEC-06 |

The removal is measurable, not assumed. Audit §10 shows 0.1.1 inside the 72-hour window, 0.1.0 at
57 days, 16 weekly downloads and a single maintainer. The npm policy allows a full unpublish on
those numbers.

## Findings

| Finding | Severity | Status | Evidence | Summary |
| ------- | -------- | ------ | -------- | ------- |
| SEC-01 | high | resolved | audit §14: the four prefixes now return `true`, with a table test. | NAT64, 6to4 and Teredo no longer reach loopback. |
| SEC-02 | high | resolved | audit §14: `createPinnedLookup` feeds an undici `Agent` per hop, with tests. | The connection dials the approved address only. |
| SEC-03 | high | resolved | audit §14: SDK 1.5.2, `zod` declared, overrides in place, audit clean, 166 tests. | The TLS bypass and the rest left the tree. |
| SEC-04 | high | open | audit §14: README and SECURITY.md carry the advisory. The npm message cannot change without a publish. | Only the registry-side notice is missing. |
| SEC-05 | medium | resolved | audit §5 and §14: traces moved to the agent directory, `0o600` on create and append, 5 tests. | Traces left the project and are owner-only. |
| SEC-06 | medium | open | audit §14: the package and its icon test are gone, root suite green. Unpublish needs the npm OTP. | The tree is clean. The registry entry is not. |
| SEC-07 | low | resolved | audit §14: the tool declares the data boundary, the README repeats it, a test asserts it. | Fetched text has a stated boundary. |

## Execution note

The maintainer asked for the plan to run immediately. Five of the seven findings closed in this
run. SEC-04 and SEC-06 keep their status because the missing half is a registry write. That write
needs the npm one-time password: `npm deprecate` on `pi-mcp` and `npm unpublish @pixu1980/pi-remote`.

## Accepted risks

These are not gaps to close by code. The maintainer accepted them by recorded decision.

- **pi-mcp stays published with its advisories.** It is deprecated and `private`, so no release can
  carry a fix. The remedy is an uninstall advisory, and users who keep it keep the exposure.
- **pi-cursor depends on a vendor SDK.** The override path may break the vendor contract. The
  decision is to take the override and re-run the suite, not to fork the SDK.
- **No CI and no provenance.** The release path is a maintainer machine with 2FA, recorded in ADR
  013. A dependency advisory therefore reaches a release only when someone runs the audit.
