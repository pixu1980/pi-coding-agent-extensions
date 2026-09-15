# performance audit

- **Role**: performance v2
- **Date**: 2026-09-15
- **Scope**: Node event loop, caching, startup cost and measurement-first optimization for pi-coding-agent-extensions monorepo (pi-statusline, pi-sessions, pi-mcp, pi-web, pi-ask, pi-path-picker, pi-reasoning, pi-cursor).

Evidence only: the commands this run executed with their measured values, the files it read,
the sources it consulted. No opinions - those belong in the review.

## Evidence

| What was measured | How | Result |
| --- | --- | --- |
| pi-cursor catalog memo and single-flight | new unit tests in `packages/pi-cursor/__tests__/_cache.test.mjs` and `_models.test.mjs` reading `getCatalogCacheStats()` | after `saveCachedCatalog` the next two loads do 0 disk reads and 2 memo hits; a cold load does exactly 1 disk read; a changed file forces 1 re-read; a truncated file reads as absent and clears the memo; concurrent `discoverCursorCatalog` calls trigger exactly 1 SDK `models.list` |
| pi-cursor atomic write | new test asserting `readdirSync(dir)` after a save | `["cache.json"]` only (no temp residue), mode 0600 preserved |
| pi-cursor suite | `pnpm test` in packages/pi-cursor | 153/153 pass |
| Render bench machine context | `pnpm bench` in packages/pi-statusline, twice under load | `loadavg(1m)=118.1 cores=10 spawn-baseline=21.3ms`; cached p50 0.001 ms p99 0.012 ms; cold 0.036 ms; loop p99 2.8 ms, then a second run at loadavg 89.8 showing loop p99 16.4 ms |
| Render bench gate split | forced-breach control (budget lowered to 0.0001 ms) at loadavg 100.9 | prints `WARN (loaded machine, not enforced): loop p99 5.906ms >= 0.0001ms` and exits 0, proving the WARN branch; the pre-change code exited 1 on the same condition |
| Render bench quiet branch | run to a real breach on this machine under `PI_BENCH_QUIET=1` (real loadavg 100+, 10 cores) | run 2 of 8 breached at loop p99 **26.6 ms** and produced `GATE BREACH: loop p99 26.624ms >= 10ms` with **exit 1**; the surrounding runs proved the passing arm (`all gates pass`, exit 0). Both arms of the wall gate are therefore executed end to end. |
| Render bench override | `PI_BENCH_QUIET=1` / `=0` / unset, each against a real breach | forced-enforced: breach exits 1; forced-reported: breach (10.2 ms) warns and exits 0; unset on a loaded host: reported-only, exit 0. The remaining unproven path is only the auto-detection comparison itself (`loadavg(1m) < cores`), which the override now bypasses rather than leaves untestable. |
| Render bench invariant gate | git cache counters around the 200-frame loop | 0 background refreshes on 200 cached frames (enforced on any machine) |
| Startup bench under load | `pnpm bench` in packages/pi-mcp at loadavg 113.6 | context printed; barrel 1361.5 ms, `_mcp-panel.ts` 868.3 ms (lazy), `_mcp-setup-panel.ts` 2.4 ms, `_ui-server.ts` 0.1 ms; all gates pass |
| pi-sessions listing economics | `getSessions()` on the real agent dir (493 sessions), then again warm | cold full listing **4341.9 ms**; cached serve **0.012 ms**; stats `{dirReads:81, fileStats:493, candidatesReturned:493, filesParsed:493, linesScanned:133922}` |
| Directory stat cost | 2000 `statSync` and `existsSync` calls on a directory | `statSync` **1.80 us**, `existsSync` **0.77 us** per call |
| Parent-dir mtime behavior | write two files into the same session project subdirectory, printing both mtimes | root `sessions/` mtime unchanged by the second write; the subdirectory mtime is the one that changes |
| pi-sessions cached path after change | new unit test reading `getSessionsStats()` around two TTL-fresh calls | `dirReads`, `fileStats`, `filesParsed` all unchanged (0 discovery work), and `clearSessionsCache()` makes a new session visible immediately |
| pi-sessions invalidation wiring | new e2e test emitting `session_start` with a warm cache and a new session file on disk | the new session appears after the event, proving the handler invalidates |
| pi-sessions suite | `pnpm test` in packages/pi-sessions | 34/34 pass |
| Guardrails | `pix_tool_check` with pix-styleguide-typescript on the new `_cache.ts`, `_models.ts`, `_sessions.ts` code and pix-styleguide-javascript on `render.bench.mjs` | 59/59 pass on each |
| Skills consulted | pix-backend-workers, pix-frontend-workers, pix-toolchain-vite (full mode) | event-loop versus worker decision frame, pool and backpressure rules, bundler worker-chunk rules |
| Web source | nodejs.org module compile-cache docs (fetched 2026-09-15) | cache covers Node-compiled modules; TS shipped as source through a transform loader is outside its proven path, so it stays a spike, not a step |

## Lens coverage

- Worker threads (Node) and frontend workers: not applicable. No CPU-bound JavaScript remains on a hot path (session parsing streams, git and template work are trivially small); the only browser code is the MCP panel heartbeat timer.
- Vite toolchain: not applicable. The repo ships unbundled TS with no build step; the analogous startup lever is the lazy module graph, already verified by the startup bench.
- Algorithms quadratic on real input: not applicable to the reviewed paths. Session scanning is line-capped and top-k bounded (`MAX_SESSION_SCAN_LINES`, `MAX_SESSIONS`), and the catalog parse is a single linear pass over a bounded payload.
- Concurrent work without backpressure: covered, not applicable after review. `mapWithConcurrency` caps in-flight reads at 10 with a documented deferred (never dropped) queue, reconnects run bounded and concurrent, and panel renders are coalesced. The pi-cursor catalog is now single-flight, which removes the duplicate-work case rather than queueing it.
