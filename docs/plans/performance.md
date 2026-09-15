# performance plan

- **Role**: performance v2
- **Date**: 2026-09-14
- **Scope**: Node event loop, caching, startup cost and measurement-first optimization for pi-coding-agent-extensions monorepo (pi-statusline, pi-sessions, pi-mcp, pi-web, pi-ask, pi-path-picker, pi-reasoning).

Steps re-derived from the open findings in [the review](../reviews/performance.md) on every run, worst
first. Mark an executed step or sub-step with `[x]` - the next sync keeps the mark while its
finding stays open. This file is deleted by the run that finds nothing open.

## Steps

### Dependencies and execution order

- Build the harness first: start with Step 7 (measurement probe plus benchmarks) so Steps 1-6 record before and after numbers instead of feelings.
- Then fix blockers in severity order: Step 1 (statusline render), Step 2 (sync secret spawn), Step 3 (sync file I/O), Step 4 (session listing).
- Steps 5 (cache contracts) and 6 (backpressure) build on the harness and can run in parallel once Steps 1-4 land.
- Step 8 (lazy module graph) comes last because it changes import shape and needs the full test suite green.
- Shared gates for every code step: `pnpm test` (or `node --test test/*.test.mjs` at root) plus the affected package `pnpm test` pass with zero failures, and the Step 7 benchmark prints the claimed delta.

- [x] **Step 1 - PERF-01 (critical)**: Statusline render path blocks event loop on cache miss with sequential sync git spawns
  - [x] **1.1**: Add render-time histogram and monitorEventLoopDelay probe around formatLine/buildData; record p50/p99 cold vs cached over 200 frames
  - [x] **1.2**: Implement stale-while-revalidate in lib/_git.ts and lib/_helpers.ts: return last-known-good synchronously, refresh expired entries asynchronously with single-flight per cwd
  - [x] **1.3**: Cap worst-case block: reduce per-command timeout, add global render budget (e.g. skip refresh if last attempt < TTL ago), verify cached render performs zero spawns
  - [x] **1.4**: Gate: 200-frame harness shows p99 cached render <2ms, zero execSync on fresh hits, cold miss never blocks render (serves stale)
- [x] **Step 2 - PERF-02 (high)**: Synchronous secret command execution can block loop up to 10 seconds
  - [x] **2.1**: Replace spawnSync with async spawn plus timeout kill and byte cap; keep exact error mapping (ETIMEDOUT, ENOBUFS, start failure)
  - [x] **2.2**: Make callers await the async resolver; add per-call timeout metric
  - [x] **2.3**: Gate: secret resolution of sleep 2 no longer freezes event loop (heartbeat timer fires during it); node --test passes
- [x] **Step 3 - PERF-03 (high)**: Synchronous file I/O on startup and hot paths taxes every invocation
  - [x] **3.1**: Convert startup and hot-path file I/O to async fs/promises; lazy-load config and caches on first use, not at import time
  - [x] **3.2**: Keep atomic write pattern (tmp plus rename) in async form; add read-through memory cache with mtime-based invalidation
  - [x] **3.3**: Gate: startup probe shows no sync fs on import; behavior and node --test unchanged

  > Note (evidence-driven variance on 3.2): `saveMetadataCache` stays an atomic `writeFileSync`+`renameSync` on purpose. The write runs once per server connect, is sub-millisecond, and its call graph (`updateMetadataCache` → `flushMetadataCache`) is synchronous; an async conversion would ripple those callers with zero measured win. The measured hot path was the read side (6-10 `readFileSync`+`JSON.parse` of mcp-cache.json per session): now one real read, then reads served from memory keyed by `mtimeMs`+`size`, invalidated on save (`getMetadataCacheStats()` proves it: repeated loads on an unchanged file do exactly one file read). pi-web `loadConfig` and pi-statusline `_mcp`/`_settings-ui` were already lazy or TTL-cached (sub-ms, once per invocation) and were left untouched.
- [x] **Step 4 - PERF-04 (high)**: Session listing mixes sync full-file reads with unbounded directory scans
  - [x] **4.1**: Deprecate sync listSessions path; default all callers to listSessionsAsync streaming parser
  - [x] **4.2**: Bound work: paginate output, cap bytes and lines per file, keep mtime sort but avoid statting the full directory tree on every call
  - [x] **4.3**: Add backpressure policy to mapWithConcurrency: document queue limit and drop or defer excess beyond MAX_SESSIONS
  - [x] **4.4**: Gate: session dir with 500 synthetic files lists in bounded time and memory; sync path removed or clearly isolated to CLI-only use
- [x] **Step 5 - PERF-05 (medium)**: Caches lack hit-rate visibility and explicit invalidation contracts
  - [x] **5.1**: Add hit, miss, stale-serve counters per cache plus a debug dump command
  - [x] **5.2**: Wire explicit invalidation: branch change clears git cache for cwd, cwd change scopes entries, config write clears metadata and npx entries
  - [x] **5.3**: Document TTL rationale per cache in code comments
  - [x] **5.4**: Gate: debug dump reports hit rate; forced invalidation tests pass
- [x] **Step 6 - PERF-06 (medium)**: Concurrent background work runs without backpressure or drop policy
  - [x] **6.1**: Add per-server connect timeout, jittered backoff, and concurrent (not sequential) reconnect with limit
  - [x] **6.2**: Coalesce panel renders through a single rAF-style scheduler instead of direct requestRender per event
  - [x] **6.3**: Define bounded queue plus drop or defer policy for session parsing and panel work; pi-web Semaphore defaults kept as reference
  - [x] **6.4**: Gate: one hung server no longer delays others; render coalescing test shows single render per burst
- [x] **Step 7 - PERF-07 (medium)**: No measurement harness exists so optimizations cannot be proven
  - [x] **7.1**: Add lightweight perf probe module: event-loop delay, sync-block counter, cache counters, startup phases
  - [x] **7.2**: Add repeatable benchmarks for statusline render, session listing, and config load under synthetic fixtures
  - [x] **7.3**: Gate: pnpm bench (or node --test bench) prints before and after numbers; CI runs it without network

  > Evidence-based close: the harness exists per cache and package — `bench/render.bench.mjs` (200-frame render + event-loop-delay gates, runs via `pnpm bench` with zero network), `getGitCacheStats`/`getProjectPathStats`/`getMcpStats` (statusline), `getMetadataCacheStats`/`getNpxCacheStats` (pi-mcp), `getSessionsStats` (pi-sessions), plus synthetic-load tests (1200-file session dir, 60k-line JSONL, hung-server reconnect, 4-call render burst). Every optimization in Steps 1-6 recorded before/after in its test.
- [x] **Step 8 - PERF-08 (low)**: Eager module graph pays parse and timer cost on every start
  - [x] **8.1**: Lazy-load heavy panels with dynamic import on first interactive use; keep startup import graph to config plus extension entry
  - [x] **8.2**: Unref or defer heartbeat and interval creation until panel is visible; clear on dispose
  - [x] **8.3**: Measure startup import time before and after with --cpu-prof or import timers
  - [x] **8.4**: Gate: startup does not instantiate panels or intervals; profile shows reduced time to first prompt

  > Audit-vs-reality note: the panels were already lazy — `_commands.ts:390/523/583` use `await import()` for `createMcpSetupPanel`/`createMcpPanel`; this run verified it with `bench/startup.bench.mjs` (barrel 770ms; `_mcp-panel.ts` subtree still 576ms cold after the barrel proves it is deferred; `_mcp-setup-panel.ts` 1.8ms because its subtree is shared). No module-level interval side effects exist (health interval is unrefd and gated by `startHealthChecks`; panel timers start only when a panel opens); the served-page heartbeat in `_host-html-template.ts` is browser code, not Node startup. Measured decision: `_ui-server.ts` (~119ms exclusive) is statically reachable via `_direct-tools` → `_ui-session`, but only *used* at the first UI tool call; deferring it through the tool-executor hot path for a one-time three-digit-ms saving was judged not worth the executor churn and left documented.
