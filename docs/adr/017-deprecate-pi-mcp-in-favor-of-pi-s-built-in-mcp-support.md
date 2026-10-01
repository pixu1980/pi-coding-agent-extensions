# 017: Deprecate pi-mcp in favor of pi's built-in MCP support

- **Date**: 2026-10-01
- **Status**: accepted
- **Tags**: pi-mcp, mcp, deprecation, release, packaging
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi 0.99.0 added MCP support to the core agent: servers come from mcp.json or pi.registerMcpServer(), are managed with the built-in /mcp command and the pi mcp add|remove|list|login|logout CLI, and reach the model through the built-in mcp extension and codemode. pi-mcp predates that. It is a fork of pi-mcp-adapter whose whole reason to exist was to put an MCP adapter in front of a host that had none, and it registers its own /mcp command. When both load, pi reports that the built-in mcp extension was not loaded because the extension registered the same command, and keeps the fork. Keeping a fork of a now-core feature means carrying the protocol surface, the OAuth flow, the keyring integration and the tool-advisory policy forever, and shadowing the extension the host documents and maintains.

## Decision

Mark pi-mcp deprecated and make the deprecation durable. The manifest gains a `deprecated` field naming the built-in replacement, and scripts/release.mjs skips any package that carries it - the same way it already skips a private one - so a future release cannot republish the fork. The README opens with the replacement and the migration command, and the description is prefixed [deprecated]. The registry flag itself is applied with npm deprecate over every published version. The source stays in the repository as the record of the fork, still built and tested while it is present.

## Consequences

Buys: the built-in mcp extension and its /mcp command load again for anyone who had pi-mcp installed, pi stops maintaining a shadow of a core feature, and the release loop can no longer republish the fork by accident. Costs: the source stays in the repository as dead weight that contributors must still install to run the full test suite, and the deprecation is a two-part signal - a manifest field this repository reads and a registry flag npm reads - so the two can drift if a publish ever bypasses the loop.

## What would end this

The deprecation leans on the built-in MCP support staying in the core agent and covering the ground this fork covered. Bring back a gap the built-in does not fill - a transport or an OAuth flow it drops, or the configurable direct-tools advisory threshold that is this fork's one departure from pi-mcp-adapter - and the fork stops being a shadow and becomes a real alternative: the `deprecated` field comes off the manifest, the release loop publishes it again, and the registry flag is lifted with a new npm deprecate over the replacement range. The same reversal applies if pi ever removes or unbundles the built-in mcp extension, since then there is again no host MCP path to defer to.

## Alternatives Considered

1. Keep pi-mcp as the supported MCP path and treat the built-in as the alternative. Rejected: the built-in is the one pi maintains and documents, and a fork that shadows it inherits the whole protocol surface to keep in step.
1. Set private: true and stop publishing pi-mcp. Rejected: deprecation is a warning, not a removal. An existing install has to keep resolving, and unpublishing or hiding the package breaks any lockfile that names it. The repository's own metadata test also requires every package to stay publishable.
1. Leave the release loop alone and re-run npm deprecate after every future publish. Rejected: a step a release can forget is a step that will be forgotten, and a republished version without the flag reads as supported.
1. Delete packages/pi-mcp from the repository. Rejected: the fork and the reason it existed are history a reader of ADR 007 and its neighbours needs, and dropping the source would strand the deprecation with no artifact behind it.
