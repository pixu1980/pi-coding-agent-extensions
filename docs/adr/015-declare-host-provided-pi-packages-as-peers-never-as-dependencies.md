# 015: Declare host-provided pi packages as peers, never as dependencies

- **Date**: 2026-10-01
- **Status**: accepted
- **Tags**: dependencies, packaging, pi, typebox, peer-dependencies
- **Author**: Emiliano Pisu <pisuemiliano.1980@gmail.com>

## Context

pi's docs list the packages the host supplies to extensions: @earendil-works/pi-ai, @earendil-works/pi-agent-core, @earendil-works/pi-coding-agent, @earendil-works/pi-tui and typebox. The extension loader maps these names to its own bundled copy through jiti aliases in the built Node.js runtime and through virtual modules in the compiled binary, so an extension's `import { Type } from 'typebox'` never needs a physical copy and never gets a second instance. Commit da9d859 moved typebox into dependencies in pi-ask, pi-mcp, pi-web and pi-typesafe, together with @modelcontextprotocol/client and @modelcontextprotocol/core. The reasoning held for the Model Context Protocol packages: pi installs extensions with --legacy-peer-deps, so a non-optional peer those packages declare is never installed, and app-bridge.js failed to resolve @modelcontextprotocol/client. Applied to typebox the same move is wrong, because typebox is on the host list. The host warns at load time: "Host-provided extension packages must be declared in peerDependencies with a \"*\" range, not dependencies: typebox. Installed copies can bypass the extension loader and create duplicate runtime modules." pi-web 0.1.9 shipped that manifest and produced the warning in the user's pi startup.

## Decision

Split the two cases by whether pi itself supplies the module. A host-provided package is declared in peerDependencies with a "*" range and marked optional in peerDependenciesMeta; the copy needed for local typecheck and tests lives in devDependencies, exactly as @earendil-works/pi-coding-agent and @earendil-works/pi-tui already did. typebox moves back to peer "*" in pi-ask, pi-mcp, pi-web and pi-typesafe, with a devDependency pin so pnpm installs it locally. A package that is not on the host list and whose own dependencies declare it as a non-optional peer stays in dependencies, because pi's --legacy-peer-deps install will not provide it. A repository test, "no package declares a host-provided package as a dependency", mirrors the host's HOST_PROVIDED_EXTENSION_PACKAGES set so the rule is enforced here instead of only at pi startup.

## Consequences

Buys: pi stops reporting the extension warning, the extension loader maps typebox to its single bundled copy at runtime, and no duplicate typebox classes, registries or initialization work can be created by a physical copy in the shared tree. Local typecheck and tests keep a resolvable typebox through the devDependency. Costs: two places encode the host list (the pi host and the repository test), so a change to what pi supplies has to be reflected in the test; and the distinction between host-provided and non-host packages is now something a contributor must know, since the same symptom (a missing module at load) has two opposite fixes depending on which list the package is on.

## What would end this

The reasoning assumes pi keeps supplying typebox through the extension loader in
every runtime it ships, both the built Node.js runtime with its jiti aliases and
the compiled binary with its virtual modules, and keeps listing it as
host-provided. If pi drops typebox from that set, the mapping stops and typebox
becomes an ordinary package: it moves back to `dependencies`, its name leaves
both the host list and the repository test, and the devDependency pin goes with
it. The same reversal applies to any other package if pi stops providing it.

## Alternatives Considered

1. Keep typebox in dependencies and accept the host warning. Rejected: the warning is the host telling us a physical copy can bypass its module mapping and create duplicate runtime modules, which is a correctness and not only a cosmetic problem.
1. Declare typebox as a peer but skip the devDependency and rely on pnpm's auto-install-peers. Rejected: pnpm does not auto-install peers marked optional in peerDependenciesMeta, so local typecheck would lose resolution and fail.
1. Bundle or vendor a private typebox copy into the extensions. Rejected: this is precisely the duplicate-module outcome the host warning exists to prevent, and it would also diverge from the version pi runs with.
