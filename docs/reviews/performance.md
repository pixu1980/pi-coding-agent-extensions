# performance review

- **Role**: performance v2
- **Date**: 2026-09-15
- **Scope**: Node event loop, caching, startup cost and measurement-first optimization for pi-coding-agent-extensions monorepo (pi-statusline, pi-sessions, pi-mcp, pi-web, pi-ask, pi-path-picker, pi-reasoning, pi-cursor).

Findings distilled from [the audit](../audits/performance.md). A finding this run no longer reports is
flipped to resolved and kept one run for visibility, then removed.

| Finding | Severity | Status | Evidence | Summary |
| --- | --- | --- | --- | --- |
| PERF-09 | low | resolved | packages/pi-cursor/lib/_cache.ts:101-141 loadCachedCatalog/saveCachedCatalog use existsSync+readFileSync and writeFileSync+chmodSync with no tmp+rename; packages/pi-cursor/lib/_models.ts:504 discoverCursorCatalog reads disk on every call and concurrent calls each run sdk.Cursor.models.list with no shared promise; no in-memory memo of the parsed catalog. | pi-cursor model catalog has no memory layer or single-flight and writes non-atomically |
| PERF-10 | low | resolved | packages/pi-statusline/bench/render.bench.mjs loop-p99 gate (10 ms) breached at 29-44 ms on loadavg 125; control run shows a single git spawn at 46 ms wall and loop p99 11 ms near-idle; startup barrel measured 1742 ms vs 770 ms recorded. Wall-clock gates move with machine load, so a red run under load proves nothing about the code. | Benchmark gates assume a quiet machine and breach under load |
| PERF-11 | low | resolved | packages/pi-sessions/lib/_sessions.ts:24 getSessionsDirMtime (existsSync+statSync) runs on every getSessions call at line 42 before the TTL check at line 44; callers in _overlays.ts:38,89 hit this on every panel open. | getSessions stats the session dir before checking its own TTL |

## Resolution notes

- PERF-09: memo keyed by path+mtimeMs+size with `getCatalogCacheStats()` proving 0 disk reads after a save-prime and 1 on a cold path; single-flight around `discoverCursorCatalog`; atomic tmp+rename write keeping 0600 and the never-throw contract; `fetchModels` no longer forces a refresh on every call (explicit refresh stays in `/cursor-models`). 6 new tests, suite 153/153.
- PERF-10: both benches print machine context (loadavg, cores, spawn baseline); the render bench gained a load-invariant gate (0 background refreshes over 200 cached frames, always enforced) and demotes its wall-time budgets to WARN when `loadavg(1m) >= cores`. A `PI_BENCH_QUIET` override (unset = measure, `1` = force enforcement, `0` = force reporting) makes both arms provable on any machine, so the quiet arm no longer waits on an idle host. Verified: real breach under forced enforcement produced `GATE BREACH` and exit 1; a real breach under forced reporting warned and exited 0; unset on this loaded host reported only. The one path still unexercised is the auto-detection comparison itself (`loadavg(1m) < cores`), which the override exists to bypass.
- PERF-11: the step's premise was corrected by measurement. A cold listing costs 4341.9 ms against a 0.012 ms cached serve, and one stat costs 1.8 us, so the cached path now makes zero filesystem calls and freshness moved to an explicit contract (`clearSessionsCache()` on `session_start`, deliberately not on `turn_end`). Recorded in ADR 008.

## Out of scope observations

- Timeout and retry behavior of `sdk.Cursor.models.list` lives in `@cursor/sdk` / pi-ai and is covered by the pi-cursor SDK source and egress audit, so it was not re-audited here.
