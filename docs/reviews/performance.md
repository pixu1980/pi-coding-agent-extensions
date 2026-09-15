# performance review

- **Role**: performance v2
- **Date**: 2026-09-14
- **Scope**: Node event loop, caching, startup cost and measurement-first optimization for pi-coding-agent-extensions monorepo (pi-statusline, pi-sessions, pi-mcp, pi-web, pi-ask, pi-path-picker, pi-reasoning).

Findings distilled from [the audit](../audits/performance.md). A finding this run no longer reports is
flipped to resolved and kept one run for visibility, then removed.

| Finding | Severity | Status | Evidence | Summary |
| --- | --- | --- | --- | --- |
| PERF-01 | critical | open | packages/pi-statusline/lib/_git.ts getGitStatus cold path runs 4 sequential execSync (rev-parse, branch, rev-list, status --porcelain) with 800ms timeout each; widget render in lib/_extension.ts formatLine -> buildData -> getGitStatus/getProjectPath is sync per TUI frame. Measured cold 134ms, cached 0ms. Cache miss still blocks pi main thread. | Statusline render path blocks event loop on cache miss with sequential sync git spawns |
| PERF-02 | high | open | packages/pi-mcp/lib/_utils.ts resolveCommandSecret uses spawnSync with 10s timeout and 1MiB maxBuffer on the main thread during config resolution. | Synchronous secret command execution can block loop up to 10 seconds |
| PERF-03 | high | open | packages/pi-mcp/lib/_config.ts, _metadata-cache.ts, _npx-resolver.ts, _onboarding-state.ts, packages/pi-web/lib/_config.ts, packages/pi-statusline/lib/_settings-ui.ts and _mcp.ts use readFileSync/writeFileSync on startup and hot paths. | Synchronous file I/O on startup and hot paths taxes every invocation |
| PERF-04 | high | open | packages/pi-sessions/lib/_sessions.ts keeps sync listSessions with readdirSync/statSync/readFileSync plus content.split newline over whole files; async streaming listSessionsAsync with mapWithConcurrency exists beside it. Candidate scan stats every file then sorts all before slicing to MAX_SESSIONS. | Session listing mixes sync full-file reads with unbounded directory scans |
| PERF-05 | medium | open | Caches in pi-statusline (_git 5s, project 15s, toplevel 30s, mcp 30s), pi-mcp metadata and npx caches have TTLs but no hit-rate counters and no event-driven invalidation (branch change, cwd change, config change). | Caches lack hit-rate visibility and explicit invalidation contracts |
| PERF-06 | medium | open | packages/pi-mcp/lib/_lifecycle.ts healthCheckInterval runs setInterval reconnect loop with sequential await over keepAliveServers (slowest server delays the rest); packages/pi-mcp/lib/_mcp-panel.ts calls tui.requestRender from 8 plus sites; sessions concurrency fixed at 10 with no documented queue cap. | Concurrent background work runs without backpressure or drop policy |
| PERF-07 | medium | open | No monitorEventLoopDelay, render-time histogram, startup timer, or benchmark exists in the repo; recent optimization (statusline cache) was verified ad hoc, not by a repeatable harness. | No measurement harness exists so optimizations cannot be proven |
| PERF-08 | low | open | Barrels such as packages/pi-mcp/lib/index.ts use export star over many heavy modules; MCP panels (mcp-panel, setup-panel, host-html-template with heartbeat interval) load at startup although only needed interactively; extensions ship TS source parsed on every start. | Eager module graph pays parse and timer cost on every start |
