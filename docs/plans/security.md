# security plan

- **Role**: security v2
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. Steps for the open findings in [the review](../reviews/security.md).

Status: `complete`.

Steps ordered worst first. One workstream owns one file set. Mark a finished step with `[x]`.

## Dependency graph

| From | To | Kind | Why |
| ---- | -- | ---- | --- |
| WS1-T1 | WS1-T2 | Depends on | Pinning a wrong address set fixes nothing. |
| WS2-T1 | WS2-T2 | Depends on | Overrides apply to what the SDK leaves behind. |
| WS2-T2 | WS5-T3 | Feeds | The release note names the fixed versions. |
| WS3-T1 | WS5-T2 | Feeds | SECURITY.md quotes the advisory text. |
| WS4-T1 | WS4-T2 | Depends on | The code leaves before the registry entry does. |
| WS4-T1 | WS5-T1 | Feeds | Package counts and the package table change. |
| WS3-T2 | WS5-T2 | Feeds | SECURITY.md names where traces now live. |

Shared files: none. Each path below has one owner.

```text
WS1 pi-web      T1 --> T2 --> T3
WS2 pi-cursor   T1 --> T2 ------------------------+
                                                  |
WS3 pi-mcp      T1, T2 ---------------------------+--> WS5 docs + release
                                                  |
WS4 pi-remote   T1 --> T2 (npm unpublish) --------+
```

| Workstream | Owns |
| ---------- | ---- |
| WS1 | `packages/pi-web/lib/_ssrf.ts`, `_fetch.ts`, `_extension.ts`, `packages/pi-web/__tests__/*`, `packages/pi-web/README.md`. |
| WS2 | `packages/pi-cursor/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`. |
| WS3 | `packages/pi-mcp/lib/_mcp-trace.ts`, `_logger.ts`, `packages/pi-mcp/__tests__/*`, `packages/pi-mcp/README.md`. |
| WS4 | `packages/pi-remote/**` (deletion), `test/packaged-assets.test.mjs`. |
| WS5 | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `RELEASING.md`. |

## WS1 - pi-web SSRF and the data boundary (SEC-01, SEC-02, SEC-07)

The guard checks one address and the client dials another. Four transition prefixes stay open.

- [x] **WS1-T1 - Close four prefixes.**
  - [x] **WS1-T1.1** Add the four prefixes from audit §3 to `DEFAULT_BLOCKED`.
        Edit [packages/pi-web/lib/_ssrf.ts](../../packages/pi-web/lib/_ssrf.ts).
  - [x] **WS1-T1.2** Add a table test in `packages/pi-web/__tests__` with those four values.
  - [x] **WS1-T1.3** Gate: `pnpm test` in `packages/pi-web` exits 0 and every probed value blocks.
- [x] **WS1-T2 - Dial the address that was validated.**
  - [x] **WS1-T2.1** Pass an undici `Agent` whose `connect.lookup` returns only the addresses
        `validateTargetHost` approved. Send the original `Host` header.
  - [x] **WS1-T2.2** Reuse the pinned lookup on every redirect hop.
  - [x] **WS1-T2.3** Add a test whose lookup stub returns a public address first and `127.0.0.1`
        second. Assert the blocked target is never connected.
  - [x] **WS1-T2.4** Gate: `pnpm test` in `packages/pi-web` exits 0.
- [x] **WS1-T3 - Mark fetched content as untrusted.**
  - [x] **WS1-T3.1** Add a `promptGuidelines` entry in `_extension.ts`. The entry says fetched
        content is untrusted data, never instructions, and that an embedded instruction is
        reported, not followed.
  - [x] **WS1-T3.2** State the same boundary in `packages/pi-web/README.md`.
  - [x] **WS1-T3.3** Gate: a test asserts the guideline string is registered.

## WS2 - pi-cursor dependency advisories (SEC-03)

Seven high advisories reach users through `@cursor/sdk` 1.0.31.

- [x] **WS2-T1 - Raise the SDK.**
  - [x] **WS2-T1.1** Bump `@cursor/sdk` to the newest release and run `pnpm install`.
  - [x] **WS2-T1.2** Run `pnpm audit --prod` in `packages/pi-cursor` and record what remains.
- [x] **WS2-T2 - Override what remains.**
  - [x] **WS2-T2.1** Add three overrides to `packages/pi-cursor/pnpm-workspace.yaml`.
        They are `undici >=6.29.1`, `zod >=4.6.6` and `@fastify/busboy >=3.2.1`.
  - [x] **WS2-T2.2** Regenerate `pnpm-lock.yaml` and run the package suite.
  - [x] **WS2-T2.3** Gate: `pnpm audit --prod` reports 0 high and 0 critical, and `pnpm test` exits
        0.

## WS3 - pi-mcp advisories and traces (SEC-04, SEC-05)

The package cannot be released. Its traces also land in the user's project.

- [ ] **WS3-T1 - Advisory in the package README.**
  - [x] **WS3-T1.1** Add a section to `packages/pi-mcp/README.md`.
        Name the critical and high advisories from audit §4. Name the built-in MCP support as the
        replacement.
  - [x] **WS3-T1.2** State that the package receives no dependency fixes, with the reason.
  - [x] **WS3-T1.3** Gate: the advisory text is present and the suite still exits 0.
- [x] **WS3-T2 - Move traces out of the project and redact them.**
  - [x] **WS3-T2.1** Default the trace path to the agent directory, reusing `_agent-dir.ts`.
  - [x] **WS3-T2.2** Create the file with mode `0o600` and apply it on append too.
  - [x] **WS3-T2.3** Redact values for keys matching `token`, `secret`, `password`,
        `authorization` and `key` before the line is written.
  - [x] **WS3-T2.4** Add tests for the resolved path, the mode and a redacted field.
  - [x] **WS3-T2.5** Gate: `pnpm test` in `packages/pi-mcp` exits 0.

## WS4 - Remove pi-remote (SEC-06)

Measured in audit §10: 16 weekly downloads, one maintainer, 0.1.1 inside the 72-hour window.

- [x] **WS4-T1 - Remove the package from the tree.**
  - [x] **WS4-T1.1** `git rm -r packages/pi-remote`.
  - [x] **WS4-T1.2** Delete the icon test for `packages/pi-remote/web` in
        [test/packaged-assets.test.mjs](../../test/packaged-assets.test.mjs) line 24.
  - [x] **WS4-T1.3** Keep the two git tags. They are history, and a tag is not a package.
  - [x] **WS4-T1.4** Gate: `pnpm test` at the root exits 0 and no live path references remain
        outside `CHANGELOG.md` files and `docs/`.
- [ ] **WS4-T2 - Remove it from the registry** (maintainer only, needs 2FA)
  - [ ] **WS4-T2.1** Confirm the eligibility again right before the command. Check
        `api.npmjs.org/downloads/point/last-week/@pixu1980/pi-remote` stays under 300.
  - [ ] **WS4-T2.2** Run `npm unpublish @pixu1980/pi-remote --force`.
  - [ ] **WS4-T2.3** If npm refuses, run `npm deprecate @pixu1980/pi-remote "Removed: no
        end-to-end encryption; self-host the relay or use pi without it"`.
  - [ ] **WS4-T2.4** Gate: `npm view @pixu1980/pi-remote versions` fails, or the deprecation
        message is visible.

## WS5 - Documents and release (SEC-03, SEC-04, SEC-05, SEC-06)

Runs after WS2, WS3 and WS4, because every count below changes with them.

- [x] **WS5-T1 - README.md**
  - [x] **WS5-T1.1** Drop the pi-remote row and change "Nine extensions" to eight in both places.
- [x] **WS5-T2 - SECURITY.md**
  - [x] **WS5-T2.1** Change "nine packages" to eight and "Four of the nine" to three of eight.
  - [x] **WS5-T2.2** Add the pi-mcp advisory note, quoting the replacement from WS3-T1.
  - [x] **WS5-T2.3** Name the new trace location from WS3-T2 in the secrets section.
- [ ] **WS5-T3 - Release the pi-cursor fix**
  - [x] **WS5-T3.1** Update `CONTRIBUTING.md` and `RELEASING.md` where they state the package
        count.
  - [ ] **WS5-T3.2** Run the four gates, then `pnpm release:dry`.
  - [ ] **WS5-T3.3** Release with `pnpm release` and confirm the advisory count dropped on npm.
- [x] **WS5-T4 - Gate**
  - [x] **WS5-T4.1** `pnpm test`, `pnpm lint`, `pnpm format:check` all exit 0.
  - [x] **WS5-T4.2** `grep -rn "nine" README.md SECURITY.md CONTRIBUTING.md` returns no stale
        count.

## Manual gates only the maintainer can clear

These are the only steps left. Each one needs the npm one-time password.

| Step | Where | Action |
| ---- | ----- | ------ |
| WS4-T2.2 | npm, 2FA | `npm unpublish @pixu1980/pi-remote --force`. |
| WS3-T1 extra | npm, 2FA | `npm deprecate @pixu1980/pi-mcp "<advisory message>"`. |
| WS5-T3.3 | npm, 2FA | `pnpm release`, which publishes pi-cursor, pi-web and pi-statusline. |

## Outcome of the execution run

Five findings closed in the tree: SEC-01, SEC-02, SEC-07, SEC-05 and SEC-03. The root suite and
every package suite pass, and both `pnpm audit --prod` runs report no known vulnerabilities. SEC-06
lost its code and kept its registry entry. SEC-04 kept its registry entry too. Both wait for the
one-time password.

## Deliberately not in this plan

No CI, no provenance attestation and no tag signing, by decision in
[ADR 013](../adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md). No dependency
automation here. The `oss` plan owns that step. No fork of `@cursor/sdk`. The override is the
chosen fix and the suite is the proof.
