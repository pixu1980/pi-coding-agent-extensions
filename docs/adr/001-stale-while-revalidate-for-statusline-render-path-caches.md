# 001: Stale-while-revalidate for statusline render-path caches

- **Date**: 2026-09-14
- **Status**: accepted
- **Tags**: architecture, performance, pi-statusline
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi-statusline widget render() runs synchronously on every TUI frame. Any execSync on that path blocks the pi event loop; measured cold miss cost 134ms (4 sequential git spawns). TTL caching removed the steady-state cost but every miss still blocked the frame.

## Decision

Serve stale-while-revalidate from lib/_git.ts and lib/_helpers.ts: fresh hits served from cache, stale hits served while an async execFile refresh runs, cold misses served a neutral fallback (no git, bare dirname) while the backfill runs. Refreshes are single-flight per cwd, spawn setup deferred to setImmediate, timeout 1500ms per command, 2s floor between attempts. Added flushGitRefreshes/flushProjectPathRefreshes as diagnostic hooks and bench/render.bench.mjs with executable gates.

## Consequences

First frame after cold start or cwd change renders without git/project detail until the backfill lands (~100ms); force=true synchronous query retained for tests and explicit invalidation. Render path is spawn-setup-free (microseconds); background refresh is single-flight per cwd with 2s retry floor and unrefd deferred kick.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Worker thread for git queries: full isolation but new lifecycle, pool and message protocol for 4 short git calls — disproportionate.
1. TTL-only throttle (status quo ante): zero spawns on fresh hits but still blocks the frame with sequential execSync on every miss — the measured 134ms jank.
1. Async render path: impossible, pi widget render() is synchronous by host contract.
