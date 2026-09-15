# Architecture Decision Records

Every decision this project has taken, newest first. The numbered files in
this directory are the source of truth; this index is generated from them by
`pix_tool_process_adr`, so editing it by hand is work the next call throws away.

## Index

| #                                                                                              | Title                                                                                     | Date       | Status   | Tags                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------- |
| [012](012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md)        | Remove the dependency cooldown and consume the newest dependency versions                 | 2026-09-15 | accepted | dependencies, supply-chain, npm, pnpm, policy, oss   |
| [011](011-keep-a-fork-s-upstream-copyright-notice-instead-of-homogenizing-package-license-.md) | Keep a fork's upstream copyright notice instead of homogenizing package LICENSE files     | 2026-09-15 | accepted | licensing, compliance, npm, packaging, oss, forks    |
| [010](010-keep-a-free-plan-model-discovery-failure-off-the-startup-banner.md)                  | Keep a Free-plan model discovery failure off the startup banner                           | 2026-09-15 | accepted | pi-cursor, cursor-sdk, models, diagnostics           |
| [009](009-publish-the-local-cursor-model-catalog-to-the-sdk-instead-of-relying-on-the-clou.md) | Publish the local Cursor model catalog to the SDK instead of relying on the Cloud catalog | 2026-09-15 | accepted | pi-cursor, cursor-sdk, models, environment-variables |
| [008](008-make-the-pi-sessions-listing-cache-filesystem-free-with-explicit-invalidation.md)    | Make the pi-sessions listing cache filesystem-free with explicit invalidation             | 2026-09-15 | accepted | performance, caching, pi-sessions, invalidation      |
| [007](007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md)                                   | Lazy startup graph verified by bench in pi-mcp                                            | 2026-09-15 | accepted | architecture, performance, pi-mcp, startup           |
| [006](006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md)                         | Bounded concurrent reconnect and coalesced panel renders                                  | 2026-09-15 | accepted | architecture, performance, pi-mcp, backpressure      |
| [005](005-cache-counters-and-explicit-invalidation-contracts.md)                               | Cache counters and explicit invalidation contracts                                        | 2026-09-15 | accepted | architecture, performance, caching, observability    |
| [004](004-bounded-session-discovery-in-pi-sessions.md)                                         | Bounded session discovery in pi-sessions                                                  | 2026-09-15 | accepted | architecture, performance, pi-sessions               |
| [003](003-read-through-metadata-cache-for-pi-mcp.md)                                           | Read-through metadata cache for pi-mcp                                                    | 2026-09-15 | accepted | architecture, performance, pi-mcp, caching           |
| [002](002-async-secret-command-resolution-in-pi-mcp.md)                                        | Async secret command resolution in pi-mcp                                                 | 2026-09-15 | accepted | architecture, performance, pi-mcp                    |
| [001](001-stale-while-revalidate-for-statusline-render-path-caches.md)                         | Stale-while-revalidate for statusline render-path caches                                  | 2026-09-14 | accepted | architecture, performance, pi-statusline             |

## What each decision says

The opening sentence of each decision and of what it cost, lifted from the
file. Where a line stops short the rest is in the ADR.

| ADR                                                                                            | Decision                                                                                                                                                                                                                        | Consequence                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [012](012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md)        | Remove the cooldown.                                                                                                                                                                                                            | Buys: the configuration stops fighting the working method.                                                                                                                                                                      |
| [011](011-keep-a-fork-s-upstream-copyright-notice-instead-of-homogenizing-package-license-.md) | Pin the exception in the test instead of erasing the difference.                                                                                                                                                                | Buys: all eight published packages now carry the license text in their tarball, so the published artifacts stop breaching the terms they are distributed under, and the check is enforced by `pnpm test` instead of by...       |
| [010](010-keep-a-free-plan-model-discovery-failure-off-the-startup-banner.md)                  | Treat a plan-blocked discovery failure as expected rather than reportable.                                                                                                                                                      | Buys: a Free-plan startup prints nothing about the catalog, so a supported configuration stops looking broken; the explanation stays reachable on demand; other failures keep their diagnostics.                                |
| [009](009-publish-the-local-cursor-model-catalog-to-the-sdk-instead-of-relying-on-the-clou.md) | Keep the Cloud catalog as the live source but stop depending on it.                                                                                                                                                             | pi-cursor runs on a Free Cursor plan, because the Auto model is listed and local validation no longer needs the Cloud catalog.                                                                                                  |
| [008](008-make-the-pi-sessions-listing-cache-filesystem-free-with-explicit-invalidation.md)    | Make the pi-sessions cached path filesystem-free and move freshness to an explicit invalidation contract.                                                                                                                       | The cached listing path is filesystem-free and deterministically invalidated, at the cost of a bounded staleness window.                                                                                                        |
| [007](007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md)                                   | Verify and lock the lazy startup graph with a runnable bench instead of rewriting it: panels stay behind dynamic imports, the bench gates that the heavy panel stays lazy, and the ui-server deferral is documented as an...    | Pi-mcp ships with `bench/startup.bench.mjs` (pnpm bench) proving the heavy interactive panel stays out of the barrel graph (576ms cold after barrel import) and that no panel module regresses to eager.                        |
| [006](006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md)                         | Make reconnect concurrent with a bounded limit, per-attempt timeout with abort, and jittered exponential backoff per server; coalesce panel renders through a single microtask scheduler (createRenderCoalescer) wired at...    | checkConnections is public and takes an optional lifecycle options object (connectTimeoutMs, backoffBaseMs, backoffMaxMs, reconnectLimit) with defaults 20s/1s/60s/4. Reconnects now run concurrently with a per-attempt...     |
| [005](005-cache-counters-and-explicit-invalidation-contracts.md)                               | Add per-cache counters with stats getters, a /statusline debug command that prints hit rates, explicit branch-change invalidation wired into the footer onBranchChange hook, and an identity-keyed read-through memory cache... | Each cache exposes its own stats getter (getGitCacheStats, getProjectPathStats, getMcpStats, getMetadataCacheStats, getNpxCacheStats) with a /statusline debug command printing hit rates.                                      |
| [004](004-bounded-session-discovery-in-pi-sessions.md)                                         | Bound session discovery: top-k candidate selection by mtime (binary-search insert capped at MAX_SESSIONS), a per-file scan cap (MAX_SESSION_SCAN_LINES), an explicit concurrency limit with documented backpressure on the...   | findSessionCandidates keeps at most MAX_SESSIONS candidates via binary-search insert (memory O(500)); parseSessionFileAsync stops scanning a file at MAX_SESSION_SCAN_LINES (50k) so pathological JSONL files are never read... |
| [003](003-read-through-metadata-cache-for-pi-mcp.md)                                           | Add an identity-keyed read-through memory cache to loadMetadataCache (key: mtimeMs + size), invalidated on every saveMetadataCache, with getMetadataCacheStats() counters and shallow-copy return to prevent caller mutation... | loadMetadataCache reads the file at most once per identity change instead of once per call; repeated calls on an unchanged file are served from memory with a shallow copy defense. saveMetadataCache invalidates the memory... |
| [002](002-async-secret-command-resolution-in-pi-mcp.md)                                        | Replace spawnSync with async node:child_process exec in resolveCommandSecret, resolved under a 10s timeout and 1MiB cap with the identical error shapes; resolveCommandSecretsRecord aggregates with parallelLimit at...        | resolveCommandSecret and resolveCommandSecretsRecord are now async; callers in _server-manager.ts (connect/createConnection/createHttpTransport) and _mcp-oauth-provider.ts await them.                                         |
| [001](001-stale-while-revalidate-for-statusline-render-path-caches.md)                         | Serve stale-while-revalidate from lib/_git.ts and lib/_helpers.ts: fresh hits served from cache, stale hits served while an async execFile refresh runs, cold misses served a neutral fallback (no git, bare dirname) while...  | First frame after cold start or cwd change renders without git/project detail until the backfill lands (~100ms); force=true synchronous query retained for tests and explicit invalidation.                                     |

## By theme

Tags carried by 3 or more decisions. A decision appears under every
theme it carries, and the early ADRs that predate the tag field are listed last.

### performance

- [008](008-make-the-pi-sessions-listing-cache-filesystem-free-with-explicit-invalidation.md) Make the pi-sessions listing cache filesystem-free with explicit invalidation
- [007](007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md) Lazy startup graph verified by bench in pi-mcp
- [006](006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md) Bounded concurrent reconnect and coalesced panel renders
- [005](005-cache-counters-and-explicit-invalidation-contracts.md) Cache counters and explicit invalidation contracts
- [004](004-bounded-session-discovery-in-pi-sessions.md) Bounded session discovery in pi-sessions
- [003](003-read-through-metadata-cache-for-pi-mcp.md) Read-through metadata cache for pi-mcp
- [002](002-async-secret-command-resolution-in-pi-mcp.md) Async secret command resolution in pi-mcp
- [001](001-stale-while-revalidate-for-statusline-render-path-caches.md) Stale-while-revalidate for statusline render-path caches

### architecture

- [007](007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md) Lazy startup graph verified by bench in pi-mcp
- [006](006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md) Bounded concurrent reconnect and coalesced panel renders
- [005](005-cache-counters-and-explicit-invalidation-contracts.md) Cache counters and explicit invalidation contracts
- [004](004-bounded-session-discovery-in-pi-sessions.md) Bounded session discovery in pi-sessions
- [003](003-read-through-metadata-cache-for-pi-mcp.md) Read-through metadata cache for pi-mcp
- [002](002-async-secret-command-resolution-in-pi-mcp.md) Async secret command resolution in pi-mcp
- [001](001-stale-while-revalidate-for-statusline-render-path-caches.md) Stale-while-revalidate for statusline render-path caches

### pi-mcp

- [007](007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md) Lazy startup graph verified by bench in pi-mcp
- [006](006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md) Bounded concurrent reconnect and coalesced panel renders
- [003](003-read-through-metadata-cache-for-pi-mcp.md) Read-through metadata cache for pi-mcp
- [002](002-async-secret-command-resolution-in-pi-mcp.md) Async secret command resolution in pi-mcp

### caching

- [008](008-make-the-pi-sessions-listing-cache-filesystem-free-with-explicit-invalidation.md) Make the pi-sessions listing cache filesystem-free with explicit invalidation
- [005](005-cache-counters-and-explicit-invalidation-contracts.md) Cache counters and explicit invalidation contracts
- [003](003-read-through-metadata-cache-for-pi-mcp.md) Read-through metadata cache for pi-mcp

## Operating rules

- Record a structural decision with `pix_tool_process_adr`, when it is taken.
- Never rewrite an accepted decision. Supersede it with a new one that says why.
- Never edit this file. Edit the ADR and let the next call regenerate it.
