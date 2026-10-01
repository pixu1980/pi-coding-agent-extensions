# 018: Keep pi-mcp unpublished with three independent stops, not one manifest field

- **Date**: 2026-10-01
- **Status**: accepted
- **Tags**: pi-mcp, deprecation, release, npm, packaging, testing
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

ADR 017 marked pi-mcp deprecated in favor of pi's built-in MCP support. The declaration existed in three places - the manifest `deprecated` field, the README warning, and the release-loop skip - but the registry carried no deprecation flag at all, so `npm view @pixu1980/pi-mcp deprecated` printed nothing and a consumer installing 0.1.17 saw no warning. An audit of npm 11.19.1's publish.js also showed that the `private` field is checked only when the publish runs through the workspaces loop (`if (workspace && manifest.private)`), so it does not stop a plain `npm publish` executed inside the package directory, which is exactly how this repository publishes.

## Decision

Keep pi-mcp unpublished through three stops that fail independently: the manifest carries both `private: true` and a non-empty `deprecated` message; `scripts/release.mjs` skips the package on either key before the publish step; the registry flag is set with `npm deprecate` so the warning reaches consumers at install time; and a repository test pins all of it, asserting the deprecation message is non-empty and that release.mjs still branches on both keys.

## Consequences

Buys: three independent stops. release.mjs, the only publish path in this repository, skips the package on `private` before it reaches the publish step; the registry flag tells every consumer, in the install output, that the package is dead; and a repository test fails if either the manifest markings or the release-loop branches are removed. Costs: the registry flag is per version, so a version published after the deprecation would not carry it and would have to be deprecated again; and `private: true` is not the hard stop it looks like, because npm applies that guard only to workspace publishes, so a plain `npm publish` run from inside the package directory would still proceed. The release loop is therefore the enforcement, not the manifest, and the test says so instead of implying otherwise.

## What would end this

The assumption this leans on, and the observation that would make it wrong.

## Alternatives Considered

1. Rely on the manifest `deprecated` field alone, which only makes release.mjs skip the package and leaves the guarantee inside one if-statement
1. Ask npm support to remove the package, which is outside the repository's control and would break the existing installs the deprecation is meant to keep resolving
