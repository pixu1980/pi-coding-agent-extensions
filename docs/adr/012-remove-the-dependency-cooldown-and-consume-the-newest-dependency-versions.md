# 012: Remove the dependency cooldown and consume the newest dependency versions

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: dependencies, supply-chain, npm, pnpm, policy, oss
- **Author**: Emiliano Pisu `<pisuemiliano.1980@gmail.com>`

## Context

The repository configured `minimumReleaseAge=4320` in `.npmrc`, a 72-hour delay before a newly published dependency version is eligible. Investigating the working tree during the OSS-01 run showed the delay was already being bypassed rather than honoured. `@types/node@26.6.0` was published 2026-09-15T16:41:20Z, 3.9 hours before the run, and `typebox@1.3.31`, `vitest@5.0.1` with its `@vitest/mocker` and `@vitest/spy` siblings, and `@types/node@26.6.0` all resolved inside the window. pnpm handled that by writing `minimumReleaseAgeExclude` lists into the workspace files of `pi-ask`, `pi-cursor`, `pi-mcp` and `pi-web` on its own, which means the control was not blocking anything; it was generating exemption paperwork per package. A dependency policy cannot both demand the newest versions and hold a three-day delay: one of the two has to go, and the maintainer chose the delay.

## Decision

Remove the cooldown. `.npmrc` no longer sets `minimumReleaseAge`, and the per-package `minimumReleaseAgeExclude` lists are deleted rather than committed, so no package carries a standing exemption. The repository consumes the newest available dependency versions and relies on exact version pins, per-package lockfiles and the test suites instead of a release-age gate.

## Consequences

Buys: the configuration stops fighting the working method. There is no cooldown to satisfy, so no `minimumReleaseAgeExclude` lists accumulate in per-package workspace files, and a dependency bump resolves immediately instead of waiting three days or asking for an exemption. Costs: the repository gives up the control the release skill credits with blocking roughly 94 percent of malicious releases, since the median malicious package survives about 14 hours before takedown. A compromised version is therefore reachable for about 14 hours instead of being filtered by a 72-hour delay. What remains as a guard is exact pinned versions in every manifest, a per-package lockfile, a per-package test suite, and the maintainer's 2FA on the npm account.

## What would end this

The reasoning assumes one maintainer resolving dependencies on one machine, where an immediate bump is worth more than a delay. A second contributor, or any reported supply-chain incident traceable to a freshly published version, flips that balance back: the cooldown returns, and this decision is superseded rather than silently reversed.

## Alternatives Considered

1. Keep the 72-hour cooldown and give up on consuming the newest versions, pinning @types/node back to a version published before 2026-09-12. Rejected: it contradicts the working method this repository wants, and the cooldown would keep blocking every future dependency bump.
1. Keep the cooldown and maintain per-package `minimumReleaseAgeExclude` lists. Rejected: pnpm had already auto-written those lists into four packages, and they turn into permanent configuration debt that silently weakens the control while looking like policy.
1. Turn on `minimumReleaseAgeStrict` so pnpm prompts for each exempted package. Rejected: it keeps the cooldown, so it fails for the same reason as the first alternative, and it adds an interactive prompt to an unattended install.
