# performance audit

- **Role**: performance v2
- **Date**: 2026-09-14
- **Scope**: Node event loop, caching, startup cost and measurement-first optimization for pi-coding-agent-extensions monorepo (pi-statusline, pi-sessions, pi-mcp, pi-web, pi-ask, pi-path-picker, pi-reasoning).

Evidence only: the commands this run executed with their measured values, the files it read,
the sources it consulted. No opinions - those belong in the review.

## Evidence

| What was measured | How | Result |
| --- | --- | --- |
| Statusline git cache cold vs cached | `node --import tsx --eval` calling `getGitStatus(cwd, true)` then 20x cached in `packages/pi-statusline` | Cold 134ms (4 sequential `execSync`); 20 cached calls 0ms total, avg 0.000ms, zero spawns on fresh hits |
| Statusline project-path cache cold vs cached | Same harness calling `getProjectPath(cwd, "git-relative")` cold then 20x cached | Cold 29ms (1 `execSync`); 20 cached calls 0ms total |
| Sync subprocess and file I/O surface | `grep -rn "execSync\|readFileSync\|writeFileSync\|spawnSync" packages/*/lib/*.ts` | Hits in `pi-statusline` (`_git.ts`, `_helpers.ts`, `_mcp.ts`, `_settings-ui.ts`), `pi-mcp` (`_config.ts`, `_metadata-cache.ts`, `_npx-resolver.ts`, `_onboarding-state.ts`, `_utils.ts` `spawnSync`), `pi-sessions` (`_sessions.ts`), `pi-web` (`_config.ts`) |
| Render and timer pressure points | `grep -rn "getBranch()\|getContextUsage\|requestRender\|setInterval\|setTimeout" packages/*/lib/*.ts` | `pi-statusline` scans `sessionManager.getBranch()` per frame (now memoized by branch length); `pi-mcp` `_lifecycle.ts` health `setInterval`, `_mcp-panel.ts` 8+ direct `requestRender` sites, `_host-html-template.ts` heartbeat `setInterval` |
| Session listing dual paths | Read `packages/pi-sessions/lib/_sessions.ts` lines 200-330 | Sync `listSessions` (`readdirSync`/`statSync`/`readFileSync` + full `split("\n")`) coexists with async streaming `listSessionsAsync` (`createReadStream` + `readline`) capped at `MAX_CONCURRENT_SESSION_READS = 10`, `MAX_SESSIONS` slice applied after full sort |
| MCP reconnect shape | Read `packages/pi-mcp/lib/_lifecycle.ts` lines 60-110 | Health check iterates `keepAliveServers` with sequential `await manager.connect`, guarded by `activeHealthCheck` flag, interval `unref`d |
| Fetch pipeline backpressure reference | Read `packages/pi-web/lib/_fetch.ts` header | `Semaphore`-based fetch with `DEFAULT_CONCURRENCY = 3`, 30s timeout, 2MiB byte cap, 5-redirect limit — the pattern other packages should copy |
| Existing test baseline | `cd packages/pi-statusline && pnpm test` | 46 tests, 46 pass, 0 fail |
| Skill evidence consulted | Loaded `pix-backend-workers`, `pix-frontend-workers`, `pix-toolchain-vite` full skill content | Treated as source of truth for event-loop model, worker pooling, and build optimization; no web search available in this run, so recent-article sweep is recorded as open work in Step 7 |
