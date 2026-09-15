# 007: Lazy startup graph verified by bench in pi-mcp

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: architecture, performance, pi-mcp, startup
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

The audit assumed panels and intervals load and start at extension startup, paying parse and timer cost on every pi invocation. Measurement showed barrel import ~770ms, but the panels are already dynamic-imported in command handlers and no top-level interval side effects exist. The only statically reachable heavy leaf not used until runtime is _ui-server via _ui-session via the tool executors.

## Decision

Verify and lock the lazy startup graph with a runnable bench instead of rewriting it: panels stay behind dynamic imports, the bench gates that the heavy panel stays lazy, and the ui-server deferral is documented as an explicit non-goal for this run.

## Consequences

Pi-mcp ships with `bench/startup.bench.mjs` (pnpm bench) proving the heavy interactive panel stays out of the barrel graph (576ms cold after barrel import) and that no panel module regresses to eager. No code changed beyond the probe and package.json bench script: fake-current audit assumption that panels load at startup was already false in the codebase. The ui-server subtree stays statically reachable via the tool-executor path (~119ms exclusive), with the deferral decision and numbers documented for a future owner.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Defer _ui-session/_ui-server through the tool executor: saves ~265ms one-time but adds an await import in the critical executor path and error-handling surface, for a cost paid once per process.
1. Status quo (verified lazy panels): the genuinely heavy interactive modules are already behind dynamic imports; the remaining static subtree is required for tool registration.
