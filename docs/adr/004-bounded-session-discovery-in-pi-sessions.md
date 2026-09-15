# 004: Bounded session discovery in pi-sessions

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, pi-sessions
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi-sessions discovery collected every session file in the directory tree, stat-ed it, sorted all by mtime, then sliced to MAX_SESSIONS — memory and sort grow with the whole sessions directory, and parseSessionFileAsync read every candidate file to the end. The sync listSessions path duplicated the walk with full-file reads even though runtime uses only the cached async getSessions.

## Decision

Bound session discovery: top-k candidate selection by mtime (binary-search insert capped at MAX_SESSIONS), a per-file scan cap (MAX_SESSION_SCAN_LINES), an explicit concurrency limit with documented backpressure on the read map, removal of the sync listSessions walk, and getSessionsStats() counters as the gate proof.

## Consequences

findSessionCandidates keeps at most MAX_SESSIONS candidates via binary-search insert (memory O(500)); parseSessionFileAsync stops scanning a file at MAX_SESSION_SCAN_LINES (50k) so pathological JSONL files are never read in full and messageCount becomes an estimate beyond the cap. The sync listSessions directory walker (full-file reads) is removed; its only consumer, a unit test, now asserts the same behavior through getSessions. mapWithConcurrency takes an explicit limit and documents its backpressure contract (deferred, never dropped). getSessionsStats exposes dirReads/fileStats/candidatesReturned/filesParsed/linesScanned as the bounded-work proof.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Collect all files then sort then slice: O(n) memory and O(n log n) sort over every session file ever written — the failure mode large session directories trigger.
1. Async without top-k: the collection array grows with the session directory.
