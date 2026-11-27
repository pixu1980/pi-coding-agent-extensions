# 021: Pin the host at ^1.6.0 and gate type checking across all nine packages

- **Date**: 2026-11-27
- **Status**: accepted
- **Supersedes**: [016](016-use-a-wildcard-peer-range-for-every-host-provided-pi-package-and-pin-the-host-in.md)
- **Tags**: dependencies, packaging, pi, typescript, quality-gate
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

ADR 016 pinned the host at 0.99.1 in devDependencies and kept a wildcard peer range. The host in use then moved through ten minor releases to 1.6.1 and the pin stayed at 0.99.1, so the manifest named a host nobody ran. Nothing caught that drift either: only pi-ask, pi-cursor and pi-lyceum shipped a tsconfig.json, only pi-cursor, pi-lyceum and pi-web had a typecheck script, and the three of them were never run as a gate. A commit named for pi-statusline (c9d1118) deleted type ImportKind, type HostConfigDiscovery, McpSettings.hostConfigDiscovery and McpConfig.imports from pi-mcp/lib/_types.ts, and no gate noticed for months. The two facts a consumer needs are still separate: which host versions the extension may load into, and which host version the repository verified.

## Decision

Every @earendil-works devDependency in all nine packages moves from 0.99.1 to ^1.6.0, and each lockfile resolves 1.6.1. Peer ranges stay "*" as ADR 016 set. The caret, not an exact version, is this record's departure from ADR 016: an exact pin promised a reproducibility the repository never exercised with a gate. A typecheck that runs on every change makes minor-level freedom safe, and a caret stops the pin from ageing on every host patch. Every package now carries "typecheck": "tsc --noEmit", a tsconfig.json where it lacked one, and a root "typecheck:all" script walks packages/ the way scripts/test-all.mjs does and skips a package with no script. The four packages whose code imports no Node module (pi-path-picker, pi-reasoning, pi-sessions, pi-statusline) omit "types": ["node"] instead of taking a dependency they do not use.

## Consequences

Buys: host drift is now caught by a command rather than by a release. The first run found three real defects: pi-ask read event.prompt on a before_agent_start custom message, which carries no prompt; pi-mcp/lib/_types.ts was missing the four declarations c9d1118 deleted; and pi-web's pinned lookup callback did not match Node's LookupFunction. After the fixes pnpm typecheck:all reports 9 ok and 0 failed, and pnpm test:all reports 9 ok and 0 failed. Costs: a caret admits a host patch the repository never ran against, so the verified version is in the lockfile and nowhere else; bumping the host is still nine manifest edits plus nine lockfiles; and the gate adds one tsc run per package to every check.

## What would end this

A host patch that ^1.6.0 still resolves stops compiling, or a host minor release breaks an extension the repository ships. Either observation turns the caret back into an exact pin, and a per-package minimum turns the wildcard peer back into a floor.

## Alternatives Considered

1. Keep the exact 0.99.1 pin of ADR 016 and bump it to 1.6.0. Rejected by the repository owner: the exact pin is what aged unnoticed for ten minor releases, and a gate now makes the caret safe.
1. Pin 1.6.1, the host this machine runs. Rejected: it is the same exact pin one patch later, and it would age the same way.
1. Turn the root into a pnpm workspace with one tsconfig and project references. Rejected: the packages are standalone pnpm projects by design, and scripts/test-all.mjs walks the directory for the same reason.
1. Add @types/node to the four packages that omit it so every tsconfig is identical. Rejected: none of their code imports a Node module, so the dependency would buy nothing.
