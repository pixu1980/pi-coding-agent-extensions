# 014: Commit the app bridge browser bundle, built by a pinned script

- **Date**: 2026-09-16
- **Status**: accepted
- **Tags**: build, pi-mcp, bundle, supply-chain, reproducibility
- **Author**: Emiliano Pisu `<pisuemiliano.1980@gmail.com>`

## Context

`packages/pi-mcp/lib/_app-bridge.bundle.js` is served over the extension's local UI server and imported by the host HTML as `import { AppBridge, PostMessageTransport } from '/app-bridge.bundle.js'`. It is 295 KB of minified JavaScript that no script in the repository produced: the investigation found no build step, no bundler configuration and no reference to the file anywhere except the server that reads it and the template that names its URL. Its provenance had to be inferred from its contents, which is the problem in one sentence. That inference showed a real, already-materialised drift. The committed bundle exports 60 names; the installed `@modelcontextprotocol/ext-apps` 2.0.0 exports 62. The two missing ones are `McpUiRequestTeardownNotificationSchema` and `REQUEST_TEARDOWN_METHOD`, so the file that the browser actually runs was built from an older API surface than the host code beside it, and nothing in the repository could have noticed. `app-bridge.js` has no imports at all in 1.7.5, which is the version the bundle was built from, but 2.0.0 refactored to import `@modelcontextprotocol/client`, `@modelcontextprotocol/core` and `zod/v4` by bare specifier.

## Decision

Commit the bundle, and build it with a script that is part of the repository. `scripts/build-app-bridge.mjs` bundles `@modelcontextprotocol/ext-apps/app-bridge` with esbuild, pinned exactly as a root devDependency, resolving the dependency from `packages/pi-mcp` so the bundle is produced the way the published package will resolve it. The output is an ES module, minified, targeting the browser, self-contained, and deterministic: two runs produce identical bytes. A two-line header naming the source entry point and the exact dependency version travels with the file, so a reader can tell what it contains without rebuilding it. `pnpm build:app-bridge` regenerates it, and `test/app-bridge-bundle.test.mjs` fails when the committed bytes differ from a rebuild, when either consumed export disappears, or when a bare import survives into the output.

## Consequences

Buys: the file served to the UI always corresponds to the dependency version the package pins, and that correspondence is enforced rather than hoped for. `scripts/build-app-bridge.mjs` is the single origin, the header records the exact dependency version the bytes came from, and three tests protect it: freshness against a rebuild, the two export names the host HTML imports, and self-containment so no bare specifier reaches the browser. Costs: 688 KB committed and shipped, up from 295 KB. The growth is the dependency's, not the build's, because ext-apps 2.0.0 externalised `client` and `core` where 1.7.5 shipped them inlined; the bundle is 126 modules of which `@modelcontextprotocol/client` alone is 88 KB. A dependency bump now requires running `pnpm build:app-bridge`, which the freshness test forces by failing until it is done, and the file is generated code excluded from the linter, so its content is reviewable only through the script and the version pin rather than line by line.

## What would end this

The script exists because upstream does not publish a browser-ready bundle of the `app-bridge` entry point with its dependencies inlined. It publishes `app-with-deps` for the `App` entry instead, and that one does not carry the two names the host HTML imports. So the decision ends the day upstream ships an `app-bridge-with-deps` export, or inlines `client`, `core` and `zod` into `app-bridge.js` the way 1.7.5 inlined them. On that day the script, the committed file and its three tests all go away, and the UI server points at the dependency directly. The other observation that would end it is the opposite one: if the bundle ever needs a second entry point or an import map, committing a single generated file stops being the simpler answer and the UI server should compose modules at runtime instead.

## Alternatives Considered

1. Serve `app-with-deps.js`, which upstream ships prebuilt with its dependencies inlined. Rejected because it is not a drop-in: it exports `App`, while the host HTML imports `AppBridge` and `PostMessageTransport`. Verified by diffing the export maps of both files.
1. Serve `dist/src/app-bridge.js` directly, with no bundling at all. Impossible: it carries five bare imports (`@modelcontextprotocol/client`, `@modelcontextprotocol/core` twice, `zod/v4`, and one more), and a browser cannot resolve a bare specifier.
1. Build the bundle on install, through a postinstall script. Rejected because it would require a working bundler in every consumer's tree to run an extension, which trades a committed file for a toolchain dependency and an install-time failure mode.
1. Leave the bundle unbuilt and hand-maintained, which is what this replaces: a 295 KB artifact with no origin in the repository, already a minor version behind the dependency it was built from.
