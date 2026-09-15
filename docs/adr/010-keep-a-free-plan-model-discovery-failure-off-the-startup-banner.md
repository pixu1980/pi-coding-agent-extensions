# 010: Keep a Free-plan model discovery failure off the startup banner

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: pi-cursor, cursor-sdk, models, diagnostics
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

ADR-009 made pi-cursor explain a failed Cursor model discovery with the SDK error message, code and status, with a dedicated plan_required explanation. On a Free Cursor plan the Cloud Agent catalog answers 403 [plan_required] on every start, so that explanation is emitted on every start too. The extension works there by design: the local catalog is kept and the SDK validates local model selections in-process. The result was a startup line that reads like a fault on a configuration that is fully supported.

## Decision

Treat a plan-blocked discovery failure as expected rather than reportable. DiscoverCatalogResult gains a `quiet` flag, set by the new isPlanBlockedError predicate when the failure carries plan_required or status 403. The factory skips the stderr startup note when that flag is set; the note itself is unchanged and still appears when the user runs /cursor-models, which is an explicit request for catalog state. Every other discovery failure keeps its startup line.

## Consequences

Buys: a Free-plan startup prints nothing about the catalog, so a supported configuration stops looking broken; the explanation stays reachable on demand; other failures keep their diagnostics. Costs: the flag is a second channel next to the note string, so a future note that also deserves quiet must set both; a Free-plan user who never runs /cursor-models does not learn why the catalog is local.

## What would end this

This leans on one assumption: a `plan_required` refusal on discovery is always a supported configuration, never a symptom. It ends when either of these shows up:

- Cursor starts answering `403 plan_required` for a key that has no usable model at all. Then the quiet path hides a failure the user must act on, and startup must print again.
- A discovery failure starts carrying `plan_required` alongside another cause, for example an expired key. Then the predicate is too coarse and has to look at more than `code` and `status`.

## Alternatives Considered

1. Drop the plan_required note entirely, losing the explanation on /cursor-models as well
1. Filter the published catalog to Auto when the plan is blocked, which needs per-plan catalog knowledge the extension does not have
1. Keep the note but soften its wording, which does not remove the per-start noise
1. Cache a plan_blocked marker and print once per session, which adds state for a case the user already resolves by upgrading
