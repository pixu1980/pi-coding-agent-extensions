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
| SEC-01 | high | open | audit §3: four transition addresses return `false` from the guard. | NAT64, 6to4 and Teredo reach loopback and metadata. |
| SEC-02 | high | open | audit §3: `validateTargetHost` runs, then `fetch` resolves again. | The address checked is not the address dialed. |
| SEC-03 | high | open | audit §4: 7 high advisories through `@cursor/sdk` 1.0.31. | A published package carries a TLS bypass. |
| SEC-04 | high | open | audit §4: 1 critical and 12 high advisories in pi-mcp. | The installed adapter cannot be fixed by release. |
| SEC-05 | medium | open | audit §5: traces in `<cwd>/.pi/mcp-traces`, default mode, no redaction. | Tool arguments can land world-readable in a repo. |
| SEC-06 | medium | open | audit §7, §8, §10: third-party relay, no E2E, no inbound cap, raw errors. | Decided: delete the package and unpublish it. |
| SEC-07 | low | open | audit §6: three fetch guidelines, none names untrusted data. | Fetched text has no instruction boundary. |

## Accepted risks

These are not gaps to close by code. The maintainer accepted them by recorded decision.

- **pi-mcp stays published with its advisories.** It is deprecated and `private`, so no release can
  carry a fix. The remedy is an uninstall advisory, and users who keep it keep the exposure.
- **pi-cursor depends on a vendor SDK.** The override path may break the vendor contract. The
  decision is to take the override and re-run the suite, not to fork the SDK.
- **No CI and no provenance.** The release path is a maintainer machine with 2FA, recorded in ADR
  013. A dependency advisory therefore reaches a release only when someone runs the audit.
