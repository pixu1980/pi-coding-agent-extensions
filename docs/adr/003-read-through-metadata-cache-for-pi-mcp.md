# 003: Read-through metadata cache for pi-mcp

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, pi-mcp, caching
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

loadMetadataCache runs on several per-session hot paths (tool surface sync, prompt command registration, panel open, connect flows) and re-read and re-parsed mcp-cache.json on every call. Read + parse dwarfs the alternative: a statSync for identity comparison.

## Decision

Add an identity-keyed read-through memory cache to loadMetadataCache (key: mtimeMs + size), invalidated on every saveMetadataCache, with getMetadataCacheStats() counters and shallow-copy return to prevent caller mutation from poisoning the memory copy.

## Consequences

loadMetadataCache reads the file at most once per identity change instead of once per call; repeated calls on an unchanged file are served from memory with a shallow copy defense. saveMetadataCache invalidates the memory copy so merged writes are always re-read. getMetadataCacheStats() exposes loads/fileReads/memoryHits for the gate. The write side intentionally stays sync atomic (sub-ms, once per connect, sync call graph).

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Async fs everywhere: converts loadMetadataCache too, but its callers (syncToolSurface, resolveCachedPrompts at command-registration time, panel open) are synchronous by design — the change would cascade across the whole call graph for no measured win.
1. Wall-clock TTL cache: reintroduces stale-read bugs because the file can change at any time (saves merge); identity-keyed mtime+size is exact.
