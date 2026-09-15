# 005: Cache counters and explicit invalidation contracts

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, caching, observability
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

The Step 1-3 caches had TTLs but no hit/miss/stale counters, no debug view, and invalidation was only partial: branch switches served stale git answers until TTL, and the npx resolver re-read its JSON cache file on every server connect.

## Decision

Add per-cache counters with stats getters, a /statusline debug command that prints hit rates, explicit branch-change invalidation wired into the footer onBranchChange hook, and an identity-keyed read-through memory cache for the npx resolver mirroring the metadata cache pattern.

## Consequences

Each cache exposes its own stats getter (getGitCacheStats, getProjectPathStats, getMcpStats, getMetadataCacheStats, getNpxCacheStats) with a /statusline debug command printing hit rates. Branch change now invalidates the git and project-path entries for the cwd in the footer onBranchChange hook. The npx cache gained the same identity-keyed read-through memory copy as the metadata cache, invalidated on save. TTL rationale documented at each cache site. All counters are module-local; no shared metrics abstraction was introduced.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. No counters: optimizations stay unprovable and regressions invisible — the failure mode this run exists to prevent.
1. Shared metrics module: couples 3 packages to one abstraction for counters that each cache already tracks locally.
