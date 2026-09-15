# Handoff 01 — performance optimization execution

- **Branch**: `main`
- **Commit range**: `3cf3f60..afb2cb9` (6 commits added this session)
- **Date**: 2026-09-15
- **Role**: performance v2 (plan/audit/review + execution)

## What this session did

Executed the full `docs/plans/performance.md` plan (8 steps, all `[x]`), converting the audit findings PERF-01…PERF-08 into measured fixes across three packages, with runnable benches and per-cache stats hooks. Commits (all convention `type(scope): subject`, scope mandatory):

1. `8b0ada6 perf(pi-statusline): stale-while-revalidate render caches with hit-rate debug`
2. `3d60c53 perf(pi-mcp): async secret commands and read-through caches`
3. `049207e perf(pi-mcp): bounded concurrent reconnect and coalesced panel renders`
4. `2b04c3b perf(pi-sessions): bound session discovery with top-k and scan caps`
5. `ab7b2bf perf(pi-mcp): add startup graph bench gating lazy panels`
6. `afb2cb9 docs(performance): plan execution records and ADR 001-007`

Nothing pushed; all commits local for review on `main`.

## ADR summary (docs/adr/)

- **001** — Stale-while-revalidate for statusline render-path caches (git/project, single-flight async refresh, setImmediate-deferred spawn, 2s retry floor).
- **002** — Async secret command resolution in pi-mcp (`spawnSync` → async `exec`, 10s timeout, 1MiB cap, fan-out ≤4, `getSecretMetrics`).
- **003** — Read-through metadata cache for pi-mcp (identity-keyed mtime+size, invalidated on save, shallow-copy return, `getMetadataCacheStats`).
- **004** — Bounded session discovery in pi-sessions (top-k candidates, 50k line scan cap, explicit concurrency limit, sync `listSessions` removed).
- **005** — Cache counters and explicit invalidation contracts (`/statusline debug`, branch-change invalidation, npx read-through cache).
- **006** — Bounded concurrent reconnect and coalesced panel renders (per-attempt timeout with abort, jittered backoff, `createRenderCoalescer`).
- **007** — Lazy startup graph verified by bench in pi-mcp (panels were already dynamic-imported; `bench/startup.bench.mjs` gates the heavy panel stays lazy).

## Measured results

- Statusline render: p99 `0.014ms` cached, `0.049ms` cold fallback (was 134ms); event-loop p99 <10ms during refresh.
- pi-mcp: secret `!command` no longer freezes the loop (heartbeat test); metadata/npx caches: 1 file read per identity change; reconnect: hung server no longer delays others (~53ms pass with 50ms per-attempt timeout).
- pi-sessions: 1200 synthetic files → ≤500 candidates; 60k-line JSONL → 50k scan cap.
- Startup: barrel ~770ms (cold tsx); heavy panel subtree stays lazy (524ms cold after barrel).
- Tests: pi-statusline 54/54, pi-mcp 42/42, pi-sessions 31/31 (127 total). Benches: `pnpm bench` in pi-statusline and pi-mcp, all gates pass, zero network.

## State / open notes

- Working tree clean; next step would be reviewing the 6 local commits and, when approved, a release (`pnpm release` per package or root script) — not done here.
- Documented non-goal: `_ui-server` (~119ms exclusive) stays statically reachable via `_direct-tools` → `_ui-session` (tool executor path); deferring through the executor hot path was judged not worth the churn (see ADR-007).
- Style gate (`pix_tool_check`) timed out on infrastructure during the review run; documents were verified manually (no British spellings across performance audit/review/plan).