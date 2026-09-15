# 006: Bounded concurrent reconnect and coalesced panel renders

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, pi-mcp, backpressure
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

The MCP health loop reconnected keep-alive servers sequentially: one hung connect (no timeout) delayed every other reconnect and blocked the loop until it settled, and repeated failures were retried immediately on every 30s tick. Panel state changes called tui.requestRender directly up to 9 times per burst.

## Decision

Make reconnect concurrent with a bounded limit, per-attempt timeout with abort, and jittered exponential backoff per server; coalesce panel renders through a single microtask scheduler (createRenderCoalescer) wired at both mcp panel constructors.

## Consequences

checkConnections is public and takes an optional lifecycle options object (connectTimeoutMs, backoffBaseMs, backoffMaxMs, reconnectLimit) with defaults 20s/1s/60s/4. Reconnects now run concurrently with a per-attempt timeout that aborts the underlying attempt; failures get jittered exponential backoff per server so an outage is not hammered every health tick. Panel render pauses in both mcp panels collapse into one requestRender per microtask via createRenderCoalescer. The idle-close loop stays sequential (cheap close operations).

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Sequential reconnect (status quo ante): correct but the slowest or hung server delays every reconnect behind it, and failures retried immediately every 30s.
1. Unbounded parallel reconnect: no bounded fan-out, thundering herd on an outage.
