# 002: Async secret command resolution in pi-mcp

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, pi-mcp
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi-mcp resolves `!command` secret markers (headers, bearer token, OAuth clientSecret, stdio env) with spawnSync up to 10s timeout on the main thread. When a configured command hangs, the whole pi process freezes. All call sites are already inside async functions, so an async port is a contained change.

## Decision

Replace spawnSync with async node:child_process exec in resolveCommandSecret, resolved under a 10s timeout and 1MiB cap with the identical error shapes; resolveCommandSecretsRecord aggregates with parallelLimit at concurrency 4; expose getSecretMetrics() as the per-call timeout metric.

## Consequences

resolveCommandSecret and resolveCommandSecretsRecord are now async; callers in _server-manager.ts (connect/createConnection/createHttpTransport) and _mcp-oauth-provider.ts await them. Command entries now fan out at most 4 at a time (was sequential). Error mapping preserved (timeout 10s, 1MiB cap, exit code, empty output) plus getSecretMetrics() per-call timing hook. Any future sync caller must be updated to await.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Keep spawnSync: simplest diff but a hung `!command` freezes the pi event loop up to 10s — the measured failure mode this run exists to fix.
1. pi.exec (ExtensionAPI): async already, but couples the pure util to the extension host and changes the command/signal contract.
1. Worker thread for secrets: disproportionate; one short-lived shell at config resolution time.
