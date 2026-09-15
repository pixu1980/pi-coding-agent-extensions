# 009: Publish the local Cursor model catalog to the SDK instead of relying on the Cloud catalog

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: pi-cursor, cursor-sdk, models, environment-variables
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

The SDK model listing call reads the Cloud Agent catalog, which answers 403 plan_required on a Free Cursor plan. pi-cursor used it for discovery and reported failure as the error name only, so the user saw UnknownAgentError with no explanation. Worse, the SDK validates a local agent model selection through the same endpoint and treats a validation failure as fatal, so agent creation failed before any run started. Live probes with the affected key confirmed that agent creation finishes once the SDK local catalog override is set, that the default model id is the Auto router and the only model a Free plan may select, and that without the override every model id fails with the same 403.

## Decision

Keep the Cloud catalog as the live source but stop depending on it. Add Auto, model id default, to the fallback catalog. Publish the resolved catalog to the SDK local model catalog environment variable at startup and after the manual refresh command, so the SDK validates local model selections in process. Report a discovery failure with the SDK error message, code and status, with a dedicated explanation when the cause is plan_required.

## Consequences

pi-cursor runs on a Free Cursor plan, because the Auto model is listed and local validation no longer needs the Cloud catalog.

Buys:

- pi-cursor runs on a Free Cursor plan, since the Auto model works end to end.
- Startup diagnostics name the real cause instead of the SDK error class.
- Local model validation no longer needs a cloud round trip, so discovery can fail without blocking a run.

Costs:

- The extension writes an environment variable it does not own, and the SDK override is not part of the typed public API, so a future SDK release could rename it silently.
- The published catalog is the same list for every plan, so a named model a Free plan cannot use is still accepted by local validation and rejected later by the server.

## What would end this

This leans on one assumption: `CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON` is the SDK's supported way to validate a local model selection offline, and a Free plan's only usable model is Auto.

It ends when any of these shows up:

- A `@cursor/sdk` release stops reading the override, or validates selections through a path that ignores it. Then local runs need a different mechanism, and the fallback is to let the Cloud endpoint decide: report the plan error and keep the local catalog listable but unvalidated.
- Cursor makes the Cloud Agent catalog readable on a Free plan, or offers a local-only endpoint that lists usable models. Then discovery should call that instead, the override becomes an optimization rather than a workaround, and the fallback catalog shrinks to a bootstrapping default.
- A Free plan gains selectable named models beyond Auto. Then a single shared catalog is no longer accurate per plan, and the extension needs either a per-account catalog or plan-aware filtering before publishing.
- A user reports a model selected in pi that the server rejects, which is the visible cost of validating against the same list for every plan. That moves plan-aware filtering from "would be nice" to required.

## Alternatives Considered

1. Report only the error detail and let Free-plan users upgrade, leaving local agents unusable
1. Ship only a static catalog and drop live discovery, losing Pro model lists and parameter metadata
1. Write the key into the SDK credential store so its own fallback path works, which adds second on-disk copy of the secret
