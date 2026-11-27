# oss plan

- **Role**: oss v1
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. Steps for the open findings in [the review](../reviews/oss.md).

Status: `complete`.

Steps re-derived from the open findings on every run, worst first. Mark an executed step with
`[x]`. The next sync keeps the mark while its finding stays open. One workstream owns one file
set, so no two workstreams edit the same file. This file is deleted by the run that finds nothing
open.

## Dependency graph

| From | To | Kind | Why |
| ---- | -- | ---- | --- |
| WS1-T1 | WS1-T2 | Depends on | The gate must run against the new pin. |
| WS1-T2 | WS1-T3 | Depends on | The ADR records what the gate proved. |
| WS3-T1 | WS5-T2 | Feeds | The backfill uses the new release-note command. |
| WS1-T3 | WS4 | Feeds | The docs name the pin and the fifth gate. |
| WS3-T1 | WS4 | Feeds | RELEASING.md documents the step that now exists. |
| WS5-T1 | WS4-T5 | Feeds | FUNDING.md links the tier once it exists. |
| WS5-T4 | WS4-T2 | Feeds | CONTRIBUTING.md describes the update path. |
| WS2 | WS4-T2 | Feeds | CONTRIBUTING.md states the hook isolation. |

Shared files: none. Each path below has one owner, so no edge is a CONFLICT edge.

```text
WS1 pin + type gate  T1 -> T2 -> T3 ------------------+
                                                      |
WS3 release notes ------------------------------------+--> WS4 docs
                                                      |
WS5 settings  T1, T4 -------- T2 needs WS3 -----------+
WS2 test isolation -----------------------------------+
```

File ownership:

| Workstream | Owns |
| ---------- | ---- |
| WS1 | `packages/*/package.json`, `pnpm-lock.yaml`, `tsconfig.json`, root `package.json`, `scripts/typecheck-all.mjs`, `docs/adr/021-*.md`. |
| WS2 | `packages/pi-statusline/__tests__/*`. |
| WS3 | `scripts/release.mjs`, `scripts/release-helpers.mjs`, `test/release-helpers.test.mjs`. |
| WS4 | `README.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`, `FUNDING.md`, `RELEASING.md`. |
| WS5 | `.github/dependabot.yml`. |

## WS1 - Host pin and type gate (OSS-23)

The tested host is 0.99.1. The running host is 1.6.0. Nothing type-checks against it. This
workstream closes both halves.

- [ ] **WS1-T1 - Pin the host to 1.6.0.**
  - [ ] **WS1-T1.1** Set `devDependencies` host and TUI entries to `1.6.0` in all ten manifests. Keep the peer range `*` that [ADR 016](../adr/016-use-a-wildcard-peer-range-for-every-host-provided-pi-package-and-pin-the-host-in.md) set.
  - [ ] **WS1-T1.2** Run `pnpm install` in each package so its lockfile matches. Gate:
        `pnpm install --frozen-lockfile` exits 0 in all ten packages.
- [ ] **WS1-T2 - Make type checking a gate.**
  - [ ] **WS1-T2.1** Add `typescript` `7.0.2` to `pi-path-picker`, `pi-reasoning`,
        `pi-sessions` and `pi-statusline`. Regenerate their lockfiles.
  - [ ] **WS1-T2.2** Add a `typecheck` script to `pi-ask`, `pi-mcp`, `pi-path-picker`,
        `pi-reasoning`, `pi-sessions` and `pi-statusline`. Use `tsc --noEmit` with a
        `tsconfig.json` where the package has none. `pi-ask` ships a `tsconfig.json`, `pi-mcp`
        does not.
  - [ ] **WS1-T2.3** Add `scripts/typecheck-all.mjs` and a root `typecheck:all` script. Walk
        `packages/` the way `scripts/test-all.mjs` does. Skip a package with no script.
  - [ ] **WS1-T2.4** Run `pnpm typecheck:all` against the 1.6.0 types. Fix what it reports.
        Gate: `pnpm typecheck:all` exits 0.
- [ ] **WS1-T3 - Record the pin.**
  - [ ] **WS1-T3.1** Write the ADR that supersedes
        [ADR 016](../adr/016-use-a-wildcard-peer-range-for-every-host-provided-pi-package-and-pin-the-host-in.md)
        with host 1.6.0. Use `rule_tool_process_adr` so `docs/adr/ADR.md` stays generated.

## WS2 - Test isolation (OSS-24)

Eight tests depend on the contributor's global git configuration.

- [ ] **WS2-T1 - Stop temp repositories from running contributor hooks.**
  - [ ] **WS2-T1.1** Isolate the hook path in the three pi-statusline test helpers. Use
        `git -c core.hooksPath= commit -qm "test: fixture"`.
  - [ ] **WS2-T1.2** Add `packages/pi-statusline/__tests__/_git-hooks.test.mjs` and import it
        from `__tests__/index.test.mjs`. It points `GIT_CONFIG_GLOBAL` at a config whose
        `commit-msg` hook exits 1. It commits in a temp repository and asserts success.
  - [ ] **WS2-T1.3** Gate: `pnpm test` in `packages/pi-statusline` exits 0 with that poisoned
        `GIT_CONFIG_GLOBAL`, and exits 0 without it.

## WS3 - Release notes and tag policy (OSS-12, OSS-25)

Ten published versions, zero GitHub Releases. The note belongs beside the tag it documents.

- [ ] **WS3-T1 - Turn every tag into a release note.**
  - [ ] **WS3-T1.1** Add a helper to `scripts/release-helpers.mjs`. It builds
        `gh release create "<name>@<version>" --title ... --notes-file ...`. Unit test it in
        `test/release-helpers.test.mjs`.
  - [ ] **WS3-T1.2** Call it from `scripts/release.mjs` after the tag push and before
        `npm publish`. A failed publish then never leaves a note pointing at nothing. In
        `--dry-run`, print the command.
  - [ ] **WS3-T1.3** Gate: `pnpm release:dry` prints the `gh release create` line for each
        package it would release. Root `pnpm test` stays green.
- [ ] **WS3-T2 - State the tag policy in code.**
  - [ ] **WS3-T2.1** Assert in `test/release-helpers.test.mjs` that `standardVersionCommand`
        never emits `--sign`. An unsigned tag stays a decision, not an oversight.

## WS4 - Documents aligned with what exists (OSS-06, OSS-12, OSS-14, OSS-23, OSS-24, OSS-25, OSS-26)

Depends on WS1, WS3 and WS5. A document must not name a command before the command exists.

- [ ] **WS4-T1 - README.md.**
  - [ ] **WS4-T1.1** Replace the support sentence at line 9 with the host version the suite
        runs against. Cite the new ADR.
  - [ ] **WS4-T1.2** Point the Contributing section at open issues labeled `good first issue`.
- [ ] **WS4-T2 - CONTRIBUTING.md.**
  - [ ] **WS4-T2.1** Add `typecheck:all` to the gate list, in the shape of the other four.
  - [ ] **WS4-T2.2** State that the suite must pass with a global hooks path configured.
  - [ ] **WS4-T2.3** Describe how a dependency pull request is handled. Match WS5-T4.
- [ ] **WS4-T3 - RELEASING.md.**
  - [ ] **WS4-T3.1** Document the release-note step and the backfill command from WS3-T1.
  - [ ] **WS4-T3.2** Add a tag and signature paragraph. Annotated tags, unsigned by decision,
        older lightweight tags left as they are.
  - [ ] **WS4-T3.3** Record why there is no root `CHANGELOG.md`. Record that there is no
        product roadmap, next to the cadence paragraph.
  - [ ] **WS4-T3.4** Name the tested host version in the preconditions.
- [ ] **WS4-T4 - GOVERNANCE.md.**
  - [ ] **WS4-T4.1** Record the Discussions decision. Off until demand, with the reason.
- [ ] **WS4-T5 - FUNDING.md.**
  - [ ] **WS4-T5.1** State what a visitor sees today. Link the tier once WS5-T1 exists.

## WS5 - Settings and account actions (OSS-06, OSS-12, OSS-18)

Only the maintainer can clear these. One changes a file. The rest are settings.

- [ ] **WS5-T1 - Give the Sponsors listing something to buy** (maintainer only)
  - [ ] **WS5-T1.1** Create one priced tier at `https://github.com/sponsors/pixu1980/dashboard`.
        Gate: the GraphQL `sponsorsListing.tiers.totalCount` returns 1 or more.
- [ ] **WS5-T2 - Backfill the release notes** (after WS3-T1)
  - [ ] **WS5-T2.1** Create one GitHub Release per tag published on npm. Use that package's
        changelog section. Gate: `gh api repos/.../releases --jq length` returns 10 or more.
- [ ] **WS5-T3 - Clear the stale dependency pull request.**
  - [ ] **WS5-T3.1** Comment on PR #3 that `pi-mcp` is deprecated and cannot be released. Close
        it and delete branch `dependabot/npm_and_yarn/packages/pi-mcp/npm_and_yarn-8bbb79c431`.
        Gate: open pull request count is 0.
- [ ] **WS5-T4 - Commit the dependency-update configuration.**
  - [ ] **WS5-T4.1** Add `.github/dependabot.yml` with one `npm` entry per supported package
        directory. That is 9 entries, `pi-mcp` excluded. Weekly schedule, `npm_and_yarn` group.
        Gate: the file returns 200 on the default branch.

## Manual gates only the maintainer can clear

| Step | Where | Action |
| ---- | ----- | ------ |
| WS5-T1.1 | GitHub Sponsors dashboard | Create one priced tier. |
| WS5-T2.1 | GitHub releases | Backfill one release per published tag. |
| WS5-T3.1 | Pull request #3 | Close with the deprecation reason. Delete the branch. |

## Deliberately not in this plan

No CI and no provenance attestation, by decision in
[ADR 013](../adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md). No tag
signing, no CLA and no DCO. OSS-25 asks for the policy to be written, not for the process to
change. No product roadmap. The maintainer states direction, and a plan would invent it.
