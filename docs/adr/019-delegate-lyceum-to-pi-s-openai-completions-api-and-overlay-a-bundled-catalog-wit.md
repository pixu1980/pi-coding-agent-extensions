# 019: Delegate Lyceum to pi's openai-completions API and overlay a bundled catalog with live discovery

- **Date**: 2026-11-27
- **Status**: accepted
- **Tags**: pi-lyceum, provider, openai-completions, models, discovery, security
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

Lyceum serves an OpenAI-compatible Chat Completions API at https://api.lyceum.technology/openai/v1 with streaming SSE, tool calling, reasoning_effort (none/low/medium/high) and usage in the stream. Its GET /models endpoint is the authoritative id list, but its OpenAPI schema declares no response shape, and the published model page is the only source for context windows and USD prices per million tokens. The provider must work before the first network call and must not open a second network path: pi already implements an OpenAI-compatible transport, and this repository treats every outbound host as an audited surface.

## Decision

Register a complete pi provider that delegates every chat turn to pi-ai's openai-completions implementation and ships a bundled catalog snapshot (16 chat models; the embedding model excluded) with context windows, prices, modalities and reasoning flags. Live discovery is an overlay through fetchModels: known ids keep the bundled metadata, unknown ids are added with documented conservative defaults (131072 context, 16384 output, text-only, zero cost, no reasoning), embedding-capable ids are dropped, and a discovery failure returns nothing so the bundled catalog stays. Provider compatibility pins max_tokens, reasoning_effort, usage-in-stream, no store and no developer role, and maps pi thinking levels onto the documented enum with off -> none. The API key has exactly one source, pi's credential store written by /login lyceum, with no environment fallback.

## Consequences

Buys: chat traffic uses the host transport (no custom streaming code to keep in sync), the model list is priced and usable offline, a discovery failure cannot empty the picker, and exactly one host is reachable from this package (asserted at source level together with no process spawn, no filesystem write and no process.env).

Costs: because a live refresh can only overlay the bundled baseline, a retired model stays selectable until the next release and answers 404; and a model id the bundle does not know is listed with placeholder cost and a conservative context window until a release carries its real metadata.

## What would end this

The bundle stops being necessary or the overlay stops being safe. It ends when GET /models publishes a declared schema with context windows and prices, at which point discovery can own the metadata and the bundled snapshot shrinks to an offline bootstrap; when pi exposes a way for a provider to replace a baseline list rather than overlay it, so a retired model disappears on refresh; or when Lyceum changes its reasoning parameter away from the documented reasoning_effort enum, which invalidates the compatibility pin and the thinking map.

## Alternatives Considered

1. Configure the endpoint in models.json instead of shipping an extension. Rejected: the user asked for a package, and a package can own the curated metadata, the thinking-level map and the refresh command.
1. Implement a custom streamSimple. Rejected: the protocol is already supported, and copying the transport would duplicate message conversion, tool handling, usage accounting and cancellation.
1. Register only the live catalog with no bundled baseline. Rejected: the picker would be empty offline and before the first refresh, and an outage would empty it entirely.
1. Read rich model metadata from GET /models. Rejected for now: the endpoint declares no schema, so the parser reads the documented OpenAI id shape only and the bundle stays the metadata source.
