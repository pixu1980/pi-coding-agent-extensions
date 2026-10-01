# 016: Use a wildcard peer range for every host-provided pi package and pin the host in devDependencies

- **Date**: 2026-10-01
- **Status**: accepted
- **Tags**: dependencies, packaging, pi, peer-dependencies, typebox, testing
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi's docs list the packages the host supplies to extensions - @earendil-works/pi-ai, @earendil-works/pi-agent-core, @earendil-works/pi-coding-agent, @earendil-works/pi-tui and typebox - and say to declare each in peerDependencies with a "*" range. ADR 015 applied that to typebox alone, while pi-coding-agent, pi-tui and pi-ai kept a floor of ">=0.85.1". The host in use is pi 0.99.1, and the packages were only ever exercised against 0.85.1. A floor written when 0.85.1 was current is a compatibility claim nobody re-checks, and it hid the fact that the ci host version had moved six minor releases ahead. The two facts a consumer needs are separate: which host versions the extension is allowed to load into, and which host version the maintainer actually tests against.

## Decision

Every host-provided package is declared in peerDependencies with a "*" range, matching pi's own guidance, and the host is pinned in devDependencies at the installed version, 0.99.1, so local typecheck and the package test suites run against the host that will load them. The wildcard peer says the host may be any version pi ships; the pinned devDependency says what the repository verified. All ten packages were installed at 0.99.1 and their suites re-run against it: all pass, and the three packages with a tsconfig typecheck clean. The manifest keeps typebox and the @earendil-works names out of dependencies, as pi warns when a physical copy can shadow its module mapping.

## Consequences

Buys: the peer range stops making a claim the repository cannot support, the tested host is visible and reproducible, and the two facts - what may load, and what was verified - live where each belongs. Costs: a wildcard peer no longer stops a consumer on an incompatible host from installing, so the honest signal moves entirely into the devDependency pin and the test run; and bumping the host is now a repository chore that touches every package at once, which the standalone-project layout makes ten edits instead of one.

## What would end this

The wildcard rests on pi keeping two promises: that it supplies these names through the extension loader in every runtime it ships, so a physical copy is never needed, and that it accepts a wildcard peer as the declaration of that. Drop the first - pi stops providing one of the packages - and that package becomes an ordinary dependency with a range and a devDependency pin like any other. Drop the second, or let the host API drift until an old host can no longer load an extension the repository tests on the new one, and a wildcard stops being honest: the peers go back to a floor that names the oldest host the code still runs on, and the devDependency pin stays where it is.

## Alternatives Considered

1. Keep a floor and raise it to >=0.99.0. Rejected: it narrows who can install the extension to buy a guarantee the repository never enforced, and pi's own docs ask for a wildcard.
1. Leave >=0.85.1 untouched. Rejected: it claims support that nothing here tests any more, and it is the reason the drift to 0.99.1 went unnoticed.
1. Declare the host in dependencies so it is always installed. Rejected in ADR 015 and still rejected: pi maps these names to its bundled copy and warns about a physical duplicate.
