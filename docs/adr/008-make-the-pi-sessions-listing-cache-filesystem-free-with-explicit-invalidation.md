# 008: Make the pi-sessions listing cache filesystem-free with explicit invalidation

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: performance, caching, pi-sessions, invalidation
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

PERF-11 planned to drop a `statSync` from pi-sessions' cached `getSessions` path on the assumption it was a redundant syscall guarding a 5-minute TTL. Measurement contradicted the premise: on the real agent dir (493 sessions, 133,922 scanned lines) a cold listing costs 4341.9 ms while a cached serve costs 0.012 ms, and one directory stat costs 1.8 us (0.00004% of the listing it guarded). The existing mtime check also did not deliver its stated invalidation: it statted the PARENT `sessions/` directory, and writing a session into an existing project subdirectory leaves that mtime unchanged, so it only ever detected brand-new project directories. The cache is therefore the load-bearing optimization, and any invalidation strategy that clears it frequently makes panel opens pay seconds.

## Decision

Make the pi-sessions cached path filesystem-free and move freshness to an explicit invalidation contract. `getSessions` serves the cached list for `CACHE_TTL_MS` without any stat, and `clearSessionsCache()` is the single invalidation hook, wired to the `session_start` event (free: two assignments, once per pi session; the next panel open re-lists regardless). Deliberately NOT wired to `turn_end`, because clearing per turn would make panel opens pay the multi-second listing repeatedly - the opposite of the goal. The mtime check, its `cacheDirMtime` state, and the redundant `existsSync` were deleted rather than kept as documentation.

## Consequences

Buys:

- Zero filesystem calls on the cached path: the 0.012 ms serve is now true on every open, with no syscall residue.
- Freshness is deterministic instead of accidental: a session file that exists when pi starts its session is guaranteed to appear on the next panel open, which the mtime check never guaranteed.
- The staleness ceiling is one number (`CACHE_TTL_MS`), and the only code that can invalidate is one named function - so cache behavior is auditable by reading two symbols instead of reconstructing mtime semantics.
- Dead state removed: `getSessionsDirMtime`, `cacheDirMtime`, and the redundant `existsSync` are gone, so nobody maintains an invalidation path that does not invalidate.

Costs:

- A session file created *during* a pi session (not at `session_start`) is invisible until the TTL expires or another `session_start` fires. Worst case is 5 minutes, and it only affects the listing, not the running session.
- The one syscall that could have narrowed that window is gone, so the window cannot be narrowed later by measurement alone - it needs a real signal (see below).
- Tests that relied on directory-mtime invalidation had to be rewritten around `clearSessionsCache()` instead.

## What would end this

This leans on one assumption: a stale listing is cheap because the panel is opened deliberately and rarely, so serving up to 5 minutes of staleness is better than paying seconds to re-list.

It ends when either observation shows up:

- A user-visible complaint that a session is missing from `/sessions` or `/projects` after creating one, i.e. staleness became a real problem rather than a theoretical one. Then the fix is a real signal, not a stat: pi emits no session-file-written event today, so the options are a `turn_end` hook with a minimum interval (bounded re-listing, e.g. at most once per 30 s) or a cheap inotify/`fs.watch` subscription on the sessions directory.
- Listing cost dropping far enough that a sub-second re-list is affordable on the machines that matter (fewer sessions, faster disk, or a top-k scan that avoids parsing 133k lines). At that point a short TTL beats any invalidation scheme because it removes the correctness question entirely.
- A measurement showing `getSessions` called in a hot loop rather than on user action. The whole trade-off assumes panel-open frequency; per-frame callers would make the 5-minute TTL the wrong instrument regardless of invalidation.
