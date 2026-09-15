# 011: Keep a fork's upstream copyright notice instead of homogenizing package LICENSE files

- **Date**: 2026-09-15
- **Status**: accepted
- **Tags**: licensing, compliance, npm, packaging, oss, forks
- **Author**: Emiliano Pisu `<pisuemiliano.1980@gmail.com>`

## Context

OSS-01 found that 6 of the 8 published packages shipped without the license text: `pi-ask`, `pi-cursor`, `pi-path-picker`, `pi-reasoning`, `pi-sessions` and `pi-statusline` had no LICENSE file and did not list one in their `files` array, so `@pixu1980/pi-ask` and `@pixu1980/pi-statusline` tarballs on npm contained no license text at all. The license requires its notice to accompany every copy. While fixing it, the first version of the plan step asserted every package LICENSE must be byte-identical to the root LICENSE. That would have overwritten `packages/pi-mcp/LICENSE`, which carries `Copyright (c) 2026 Nico Bailon`: pi-mcp is a fork of `pi-mcp-adapter` and its README states that all credit for the original design and implementation goes to Nico. Homogenizing that file would have deleted a copyright notice the license obliges us to retain, turning a compliance fix into a compliance breach.

## Decision

Pin the exception in the test instead of erasing the difference. Every published package ships a LICENSE and lists it in `files`. Packages that are original work carry the root LICENSE byte for byte; a package that is a fork keeps the upstream copyright holder it inherited. `test/license-integrity.test.mjs` encodes both halves: it asserts byte-identity for originals, and it holds an explicit `forkCopyrights` map naming `pi-mcp` and the exact upstream line it must retain, so the fork assertion fails if that notice ever disappears.

## Consequences

Buys: all eight published packages now carry the license text in their tarball, so the published artifacts stop breaching the terms they are distributed under, and the check is enforced by `pnpm test` instead of by memory. A fork can no longer be silently relicensed: dropping an inherited copyright notice fails the suite. Costs: adding a fork now means adding one entry to the `forkCopyrights` map in `test/license-integrity.test.mjs`, so the exception is explicit and reviewed rather than discovered later.

## What would end this

Keeping a per-fork exception is only right while `pi-mcp` remains a fork of `pi-mcp-adapter` maintained here. If that package is ever rewritten as original work, or if the upstream project relicenses, the exception disappears and its LICENSE joins the byte-identical set. That is the observation that ends this decision.

## Alternatives Considered

1. Homogenize every package LICENSE to the root file. Rejected: it would overwrite the upstream copyright notice pi-mcp inherited from pi-mcp-adapter, which the license requires us to retain.
1. Rely on npm auto-including a LICENSE that exists in the package directory, and skip the files array entry. Rejected: it leaves inclusion implicit and undocumented, exactly the mechanism that let six packages ship without a license.
1. Add the LICENSE files without a test. Rejected: nothing would stop the next package from shipping without one, which is the failure this finding was raised for.
