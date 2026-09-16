# oss plan

- **Role**: oss v1
- **Date**: 2026-09-15
- **Scope**: the whole pi-coding-agent-extensions monorepo: the 8 published packages under packages/ plus the repository root (governance, license, release, community, funding surface)

Steps re-derived from the open findings in [the review](../reviews/oss.md) on every run, worst
first. Mark an executed step or sub-step with `[x]` - the next sync keeps the mark while its
finding stays open. This file is deleted by the run that finds nothing open.

## Roadmap

Five phases. Steps inside a phase are independent of each other unless the dependency table
says otherwise; a phase does not start until its prerequisites are green. The ordering rule
behind it: nothing that documents behavior may land before the behavior is true, because a
CONTRIBUTING.md that names a broken command is worse than no CONTRIBUTING.md.

### Phase 0 - Unblock the baseline

The repository cannot be released and its documented commands cannot be trusted, so this phase
comes first and gates everything else.

| Order | Step | Finding | Why it is here |
| ----- | ---- | ------- | -------------- |
| 0.1 | Step 7 | OSS-07 | Done. A dirty tree aborted the release path and made every package look release-worthy; it landed in its own commit, the tree is clean and the release path runs again. |
| 0.2 | Step 9 | OSS-09 | Done. The gate exists, both commands exit 0, and a test proves the linter is not a placeholder. Step 2 still owes the contributor-facing documentation of it. |
| 0.3 | Step 16 | OSS-16 | Done. The dry run reports what it would release, and every package declares the same node floor its host declares. This closes Phase 0. |

### Phase 1 - Legal and trust floor

Independent of each other. This is what makes the published artifacts lawful and gives a
reporter somewhere private to go.

| Order | Step | Finding | Why it is here |
| ----- | ---- | ------- | -------------- |
| 1.1 | Step 1 | OSS-01 | Six of eight published packages currently breach their own license terms. Highest legal exposure. |
| 1.2 | Step 4 | OSS-04 | Half done. SECURITY.md and the README pointers are written, which is what Step 17 needs to state the exposure. The private reporting toggle is a repository setting only the maintainer can clear. |
| 1.3 | Step 15 | OSS-15 | Done. The mailmap folds three historical identities into one, and the repository-local git identity was already canonical. |
| 1.4 | Step 17 | OSS-17 | Done. ADR 013 records the decision and the exposure, and SECURITY.md publishes it. This closes Phase 1. |

### Phase 2 - Contributor entry

This is the phase a newcomer walks through, so each document must describe commands that Phase 0
already proved work.

| Order | Step | Finding | Why it is here |
| ----- | ---- | ------- | -------------- |
| 2.1 | Step 3 | OSS-03 | Done. Contributor Covenant 3.0 is in place with the reporting channel filled. The Conduct section CONTRIBUTING.md must link to it carries over to Step 2. |
| 2.2 | Step 2 | OSS-02 | Done. CONTRIBUTING.md carries its own content plus the three obligations carried from steps 3.3, 9.4 and 15.3. The community-profile half of the gate needs a push. |
| 2.3 | Step 5 | OSS-05 | The governance document describes the path Step 2 publishes and references the ADR from 1.4. |

### Phase 3 - Sustainability and visibility

| Order | Step | Finding | Why it is here |
| ----- | ---- | ------- | -------------- |
| 3.1 | Step 6 | OSS-06 | Step 6.3 writes the maintainer and donor boundary into GOVERNANCE.md, so it follows Step 5. |
| 3.2 | Step 12 | OSS-12 | Release notes and cadence depend on a releasable tree (Step 7) and on governance naming the release gate (Step 5). |
| 3.3 | Step 14 | OSS-14 | Discoverability. Independent, but best done once the landing documents exist so topics and the homepage point at real pages. |
| 3.4 | Step 18 | OSS-18 | Depends on Step 7 for the dependency decision and on Step 2 for the manual dependency-update paragraph. |

### Phase 4 - Remaining hygiene

| Order | Step | Finding | Why it is here |
| ----- | ---- | ------- | -------------- |
| 4.1 | Step 8 | OSS-08 | The pnpm-only policy is documented in CONTRIBUTING.md, so it follows Step 2. Its guard test is independent and can land earlier. |
| 4.2 | Step 10 | OSS-10 | Done. Six of eight packages were affected rather than three, and the fix uncovered OSS-22 in pi-web's typecheck script. pnpm test and pnpm typecheck now exit 0 everywhere. |
| 4.3 | Step 11 | OSS-11 | Needs the pinned tooling baseline from Step 9 before a build script can be committed. |
| 4.4 | Step 13 | OSS-13 | Italian prose in two remaining repository-owned files; .npmrc was translated when the cooldown was removed. |
| 4.5 | Step 19 | OSS-21 | The 167 diagnostics behind the twenty disabled Biome rules. Correctness defects first, style last, and the disabled list shrinks as each count reaches zero. |

### Dependency table

| Step | Finding | Depends on | Blocks |
| ---- | ------- | ---------- | ------ |
| 1 | OSS-01 | - | - |
| 2 | OSS-02 | 3, 7, 9 | 5, 8 |
| 3 | OSS-03 | - | 2 |
| 4 | OSS-04 | - | 17 |
| 5 | OSS-05 | 2, 3, 17 | 6, 12 |
| 6 | OSS-06 | 5 | - |
| 7 | OSS-07 | - | 2, 12, 16, 18 |
| 8 | OSS-08 | 2 | - |
| 9 | OSS-09 | - | 2, 11 |
| 10 | OSS-10 | - | - |
| 11 | OSS-11 | 9 | - |
| 12 | OSS-12 | 5, 7 | - |
| 13 | OSS-13 | - | - |
| 14 | OSS-14 | - | - |
| 15 | OSS-15 | - | - |
| 16 | OSS-16 | 7 | - |
| 17 | OSS-17 | 4 | 5 |
| 18 | OSS-18 | 2, 7 | - |
| 19 | OSS-21 | - | - |

Critical path: 7 -> 2 -> 5 -> 12. That is the longest chain and it ends with the release
cadence a contributor can finally plan around.

### Manual gates only the maintainer can clear

These are not code changes. They are the settings and accounts that a pull request cannot make,
listed here because a step is not done until they are cleared.

| Step | Where | Action |
| ---- | ----- | ------ |
| Step 4.2 | GitHub | Enable private vulnerability reporting at `https://github.com/pixu1980/pi-coding-agent-extensions/settings/security_analysis` |
| Step 6.1 | GitHub and npm | Enable GitHub Sponsors, then land `.github/FUNDING.yml` so the button resolves |
| Step 12.1 | GitHub | Publish a GitHub Release per package version currently on npm |
| Steps 14.1 to 14.3 | GitHub | Topics, homepage, and the wiki decision |
| Steps 18.1 and 18.2 | GitHub | Resolve dependabot pull request #2 and delete its stale remote branch |

### Deliberately not in this plan

By maintainer decision taken on this run, no CI is added: no `.github/workflows` file, no npm
Trusted Publishing, no zizmor workflow, no provenance attestation. The consequence, that 0 of 8
packages carry an attestation and every release is published from a developer machine with a
personal npm credential, is recorded as an accepted risk in Step 17 and stated in SECURITY.md by
Step 17.2. It is not a gap this plan closes.

## Steps

- [x] **Step 1 - OSS-01 (high)**: Six of the eight published packages shipped without the license text, so the published artifacts breached the project's own license terms.
  - [x] **1.1**: Copied the root LICENSE into the 6 package directories that lacked one: packages/pi-ask/LICENSE, packages/pi-cursor/LICENSE, packages/pi-path-picker/LICENSE, packages/pi-reasoning/LICENSE, packages/pi-sessions/LICENSE, packages/pi-statusline/LICENSE. All six hash to 17cd14c4733dcc96687a7a741a360277636b5135556dacd3d44613b7eacc71e7, the same as the root file.
  - [x] **1.2**: Added "LICENSE" to the files array of all 8 packages/*/package.json, placed after CHANGELOG.md and before DISCLOSURE where those entries exist.
  - [x] **1.3**: Added test/license-integrity.test.mjs asserting that every package ships a LICENSE, that every manifest lists it in files, that each license carries the permission grant and the warranty disclaimer plus a copyright holder, and that originals are byte-identical to the root LICENSE. A fork is exempt from byte-identity and is pinned in the test as `forkCopyrights`, because pi-mcp must keep the `Copyright (c) 2026 Nico Bailon` notice it inherited from pi-mcp-adapter, and asserting byte-identity there would have deleted a notice the license requires us to retain. Recorded as ADR 011.
  - [x] **1.4**: Gate met: pnpm test reports 18 pass 0 fail, pnpm test:all reports 8 ok 0 failed, and npm pack --dry-run lists LICENSE in every one of the 8 package tarballs.
- [x] **Step 2 - OSS-02 (high)**: There was no contributor on-ramp at all: no CONTRIBUTING.md, no issue templates and no pull request template, so a newcomer could not tell how to propose, test or land a change.
  - [x] **2.1**: Wrote CONTRIBUTING.md with the pnpm-only setup, the four gates, the commit convention, the pull-request checklist and where to report things. It also carries the three obligations other steps deferred here: the format and lint commands from 9.4, the identity expectation from 15.3, and the conduct link from 3.3.
  - [x] **2.2**: Stated the inbound term explicitly: inbound=outbound under `MIT`, no CLA and no DCO, and said why rather than leaving it as an absence, including the assumption that would change it.
  - [x] **2.3**: Added .github/PULL_REQUEST_TEMPLATE.md with a checklist the repository can actually verify by hand.
  - [x] **2.4**: Added .github/ISSUE_TEMPLATE/bug_report.yml and feature_request.yml, both parsed as YAML to confirm they are well formed and both referencing labels the repository really defines. Worth recording that this recreates a .github directory the maintainer had removed: ADR 013 rules out workflow files, and these are metadata, not automation, but the distinction is easy to misread so it is stated here.
  - [x] **2.5**: Rewrote the root README so it answers what the repository is and how to try it: all eight packages listed with their real descriptions and an install command, the Node floor stated, and a Contributing section linking CONTRIBUTING.md, the code of conduct and the security policy. The previous text advertised themes, skills and prompts that do not exist, listed six of eight packages and ended the list with a placeholder.
  - [x] **2.6**: Gate blocked on a push, like 3.4. The profile reports contributing, issue_template, pull_request_template, code_of_conduct_file and security_policy as MISSING because none of those files is on the default branch yet; the health percentage cannot move until they are.
- [x] **Step 3 - OSS-03 (high)**: The project had no code of conduct, so it defined no behavioral standard for contributors and no enforcement path.
  - [x] **3.1**: Added CODE_OF_CONDUCT.md from the upstream markdown rather than retyping it, so the text is the official Contributor Covenant 3.0. Two things needed substitution and both are declared in the document's own Attribution section: the reporting channel, and two typographic apostrophes plus one British spelling that this repository's style rules forbid.
  - [x] **3.2**: Set the reporting channel to the maintainer's address and replaced the template's second placeholder with this project's process: the ladder below is adopted unchanged, one person acts as Community Moderator at every rung, and the steps a larger community would split between two moderators are carried out by the same person. That limitation is stated rather than implied, because a single-maintainer project has no internal escalation.
  - [ ] **3.3**: The Conduct section belongs in CONTRIBUTING.md, which Step 2 creates. Carried there rather than written twice.
  - [x] **3.4**: Gate met where it can be checked locally: no placeholder survives, the file carries no typographic apostrophes or British spellings, and it passes 59 of 59 style guardrails. The community-profile half needs the file on the default branch, so it is observable only after a push.
- [ ] **Step 4 - OSS-04 (high)**: There is no security policy and no private channel for reporting vulnerabilities, which matters more than usual here because the packages execute inside the user's agent process.
  - [x] **4.1**: Wrote SECURITY.md with the supported-version rule (latest published version per package, no backports), the reporting channel, and a 3-working-day acknowledgment target the maintainer chose.
  - [ ] **4.2**: MANUAL GATE, maintainer only. Enable private vulnerability reporting at `https://github.com/pixu1980/pi-coding-agent-extensions/settings/security_analysis`. Until this is done the channel named in SECURITY.md does not exist.
  - [x] **4.3**: Documented the trust boundary with measured detail: what pi-mcp, pi-cursor and pi-web each reach, the guards pi-web and pi-cursor enforce, and the release-integrity exposure, which is 0 of 8 packages carrying a provenance attestation, lightweight unsigned tags, no CI, and no dependency cooldown since ADR 012.
  - [x] **4.4**: Added a Security section to README.md and pointers in the three dual-use package READMEs. All four links resolve to the root SECURITY.md.
  - [ ] **4.5**: Gate, blocked on 4.2 and on a push. GitHub reports the security policy only once SECURITY.md reaches the default branch, so the community profile still shows it missing.
- [ ] **Step 5 - OSS-05 (high)**: Who decides what is undocumented: 236 commits, 0 merge commits and 1 contributor mean the real model is single-maintainer, but no GOVERNANCE.md states it, so a newcomer cannot tell who reviews or who breaks a tie.
  - [ ] **5.1**: Write GOVERNANCE.md describing the single-maintainer (BDFL) model as it actually is: who holds final say, which decisions need an ADR, and how a contested decision is resolved.
  - [ ] **5.2**: Document the contribution path end to end in GOVERNANCE.md, from issue to merge, naming the real gate at each stage given that no CI exists: the maintainer runs pnpm test and pnpm test:all locally, and which of those a change must pass.
  - [ ] **5.3**: Record the promotion criteria for a second maintainer (sustained contribution, demonstrated review judgment, security awareness) without committing to recruiting now, so the bus-factor-one risk has a written exit.
  - [ ] **5.4**: Reference docs/adr/ as the decision record from GOVERNANCE.md so the existing 10 ADRs stop being invisible, and state that ADRs are immutable once accepted.
  - [ ] **5.5**: Record the accepted risk that no CI exists and releases are published locally without provenance, so the reader knows the governance model carries that exposure deliberately.
  - [ ] **5.6**: Gate: GOVERNANCE.md exists and is linked from README.md, the accepted-risk ADR is indexed in docs/adr/ADR.md, and both land in the same commit.
- [ ] **Step 6 - OSS-06 (high)**: The project has no funding surface of any kind and is 100% single-payer, so no donor can contribute and no donor expectation is defined.
  - [ ] **6.1**: Add .github/FUNDING.yml declaring the funding platforms (`https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository`), and enable GitHub Sponsors on the account so the button resolves.
  - [ ] **6.2**: Write FUNDING.md at the repository root stating what money is used for, what it is not used for, and that sponsorship never buys roadmap priority, review priority or feature commitments.
  - [ ] **6.3**: Add a Funding section to GOVERNANCE.md defining the maintainer and donor boundary: who decides when a donor request conflicts with maintainer judgment, and that the answer is the maintainer.
  - [ ] **6.4**: Add a funding pointer to README.md and keep it below the install instructions so the README does not read as a solicitation.
  - [ ] **6.5**: Gate: the Sponsor button appears on the repository, and FUNDING.md is linked from both README.md and GOVERNANCE.md.
- [x] **Step 7 - OSS-07 (high)**: The intentional dependency bump was uncommitted, so the tree was dirty: the release path refused to run and all 8 packages were detected as release-worthy.
  - [x] **7.1**: Confirmed that the deletion of packages/pi-path-picker/package-lock.json and packages/pi-reasoning/package-lock.json is the intended npm-to-pnpm cleanup. Both stayed deleted and the deletion landed in the commit.
  - [x] **7.2**: Verified that no manifest reintroduces the `packageManager` field or a `workspaces` field. The pnpm-only shape holds across all 9 manifests.
  - [x] **7.3**: Reviewed the bump for behavior and not only for version numbers: typebox 1.3.9 -> 1.3.31, tsx 4.23.1 -> 4.23.13, @types/node to 26.6.0, commit-and-tag-version to 13.2.1, and the peer range @earendil-works/pi-coding-agent from >=0.83.0 to >=0.85.1. That review surfaced two defects the plan did not know about: every per-package lockfile had gone stale against the bumped manifests (OSS-19), and the 72-hour cooldown was being bypassed by exemptions pnpm wrote itself (OSS-20).
  - [x] **7.4**: Committed as chore(deps): bump the pi toolchain, typebox and the release tooling, together with the regenerated lockfiles, the removed cooldown and ADR 012.
  - [x] **7.5**: Gate met: git status --porcelain is empty, pnpm test reports 18 pass 0 fail, pnpm test:all reports 8 ok 0 failed, and pnpm install --frozen-lockfile succeeds in all eight packages.
- [ ] **Step 8 - OSS-08 (medium)**: The pnpm-only policy is undocumented and unenforced: two npm package-lock.json files had already crept into what are standalone pnpm packages, and nothing stops the next contributor from adding one.
  - [ ] **8.1**: Add a guard test under test/ that fails when any tracked path matches `**/package-lock.json`, when any package.json declares a `packageManager` field, or when any package.json declares `workspaces`. This half is independent and can land immediately.
  - [ ] **8.2**: Document the topology in CONTRIBUTING.md: each package under packages/ is a standalone pnpm project with its own pnpm-lock.yaml and pnpm-workspace.yaml, and the root is a script runner whose pnpm-workspace.yaml keeps `packages: []` on purpose. Install and test with pnpm inside the package being changed.
  - [ ] **8.3**: State in the same section why the per-package `overrides` and `allowBuilds` blocks differ between packages, so the divergence reads as a decision, meaning each package declares only the dependencies it needs, instead of as drift.
  - [ ] **8.4**: Add a short note to scripts/test-all.mjs explaining that it iterates packages/ by design because the root is not a workspace, so a future contributor does not turn it into a workspace command.
  - [ ] **8.5**: Gate: the guard test fails when a package-lock.json appears in a package or a `packageManager` field is added, and passes on the clean tree; pnpm test:all still reports 8 ok, 0 failed.
- [x] **Step 9 - OSS-09 (high)**: The repository had no working style gate: pnpm format targeted a directory that does not exist and pnpm lint was a no-op, so nothing enforced the house style a contributor is asked to follow.
  - [x] **9.1**: Wired the real source layout into format and format:check (packages/*/lib/**/*.ts, packages/*/index.ts, packages/*/__tests__/**/*.mjs, scripts/*.mjs, test/*.mjs) and pinned prettier 3.9.6 exactly as a root devDependency. Prettier owns formatting, which is why biome.json disables Biome's own formatter.
  - [x] **9.2**: Pinned @biomejs/biome 2.5.13 as the linter instead of ESLint. This sub-step named the ESLint setup from the handoff, and that setup cannot run here: typescript-eslint 8.70.0 declares typescript >=4.8.4 <6.1.0 while the repository is on 7.0.2, so no release of it supports this toolchain. Biome parses TypeScript 7, ships as one binary and pulls no peer dependencies.
  - [x] **9.3**: Replaced the placeholder with lint and lint:fix, and committed biome.json instead of leaving the rule set in /tmp. Two rules are off because the code does the flagged thing on purpose, with the measured reason in the commit body; the other twenty are the OSS-21 backlog.
  - [x] **9.4**: The commands are documented in the commit and the review. CONTRIBUTING.md does not exist yet, so the contributor-facing half of this sub-step belongs to Step 2. No CI runs them, by the accepted-risk decision, so running them stays a manual gate.
  - [x] **9.5**: Gate met: pnpm format:check and pnpm lint both exit 0, test/style-gate.test.mjs proves prettier accepts every hand-written file and that the linter reports noDebugger on a deliberately malformed one, pnpm test reports 20 pass 0 fail and pnpm test:all reports 8 ok 0 failed.
- [x] **Step 10 - OSS-10 (high)**: Six of eight packages were affected, not three. pi-ask, pi-path-picker and pi-web carried pnpm's unfilled allowBuilds placeholder, and pi-mcp, pi-reasoning, pi-sessions and pi-statusline carried no allowBuilds block at all. Because a placeholder string is not a boolean decision, pnpm failed pnpm test in pi-mcp, pi-path-picker and pi-web and pnpm typecheck in pi-ask and pi-web with ERR_PNPM_IGNORED_BUILDS.
  - [x] **10.1**: Declared allowBuilds explicitly in the seven packages that lacked a decided one, with @google/genai, esbuild and protobufjs set to false, matching the pi-cursor precedent. Declining rather than allowing preserves today's behavior, because the suites already pass with those build scripts ignored.
  - [x] **10.2**: Kept every block in its own package file, which is where a standalone pnpm project declares it, and made the seven sets identical to each other and to pi-cursor's. Worth recording that pnpm writes the placeholder itself when it finds ignored builds nobody has decided about: that is where the original text came from, and why the fix had to be an explicit declaration rather than a deletion.
  - [x] **10.3**: Added test/workspace-config.test.mjs, which fails when the placeholder appears in any yaml or json file and when any allowBuilds value is not an explicit boolean, so the state cannot go undecided again.
  - [x] **10.4**: Proved the fix on the commands that actually fail rather than on a dry-run install. Before: pnpm test exited 1 in pi-mcp, pi-path-picker and pi-web, and pnpm typecheck exited 1 in pi-ask and pi-web. After: both exit 0 in all eight packages, and the placeholder is gone from every configuration file.
  - [x] **10.5**: Gate met. Fixing this also revealed OSS-22, pi-web's broken typecheck script, which pnpm's failing dependency check had been hiding; it is fixed and recorded separately.
- [ ] **Step 11 - OSS-11 (medium)**: pi-mcp publishes a 295 KB minified bundle that no script in the repository builds, so neither a contributor nor a security reviewer can review what ships or reproduce it.
  - [ ] **11.1**: Identify what produces _app-bridge.bundle.js and commit the build script, with its bundler pinned as a root devDependency, so the artifact has a reproducible origin.
  - [ ] **11.2**: Either check in the TypeScript source of the bundle next to its output, or vendor the upstream package version explicitly and record the provenance in a comment header naming the exact upstream package and version.
  - [ ] **11.3**: Add a test asserting the committed bundle is up to date by rebuilding it and comparing bytes, so a stale or hand-edited bundle fails the suite.
  - [ ] **11.4**: Decide and document whether the bundle should ship at all, since shipping a build artifact inside an extension that the host serves to a local UI widens the trust surface; record the outcome and the rationale in an ADR.
  - [ ] **11.5**: Gate: a single documented command regenerates the bundle byte-for-byte, and the freshness test passes.
- [ ] **Step 12 - OSS-12 (medium)**: There is no release cadence and no release notes surface, so a contributor or user cannot plan around releases or see what changed.
  - [ ] **12.1**: Publish GitHub Releases from the existing lightweight tags so the tag-format history becomes a readable changelog, taking each release body from the package's generated CHANGELOG.md.
  - [ ] **12.2**: Write a RELEASING.md documenting the real procedure and its preconditions: clean tree, npm login, pnpm release, tag push, and which packages publish.
  - [ ] **12.3**: State a release cadence in RELEASING.md in terms a contributor can rely on, for example releases cut on demand when a package's release-worthy files change, with no fixed calendar.
  - [ ] **12.4**: Publish a ROADMAP.md or docs/roadmap.md listing what is planned per package so the community can see direction instead of inferring it from closed pull requests.
  - [ ] **12.5**: Gate: at least one GitHub Release exists per package version currently on npm, and RELEASING.md is linked from CONTRIBUTING.md.
- [ ] **Step 13 - OSS-13 (medium)**: Repository-owned files contain Italian prose, contradicting the project's own rule that every artifact except chat is written in English.
  - [ ] **13.1**: Translate the three Italian comment lines in .npmrc into English, keeping the measured justification for minimumReleaseAge=4320.
  - [ ] **13.2**: Translate the two Italian comments in packages/pi-path-picker/lib/_provider.ts around the path-token menu logic.
  - [ ] **13.3**: Change the test-all.mjs summary line and failure label to English, so the aggregator output matches the language rule every other artifact follows (there is no CI, so this output is only ever read locally by the maintainer and by contributors running the suite).
  - [ ] **13.4**: Add a guard test that scans tracked source and config files for a small list of high-signal Italian words, so the rule is enforced rather than remembered.
  - [ ] **13.5**: Gate: the guard test passes and pnpm test:all prints an English summary line.
- [ ] **Step 14 - OSS-14 (medium)**: The repository's public metadata is incomplete, so the project is hard to find and the community venues it does have are unused.
  - [ ] **14.1**: Add repository topics covering the domain and the ecosystem, for example pi, pi-coding-agent, mcp, coding-agent, llm, typescript, monorepo.
  - [ ] **14.2**: Set the repository homepage to the pi.dev gallery page for the packages, and keep description aligned with the root package.json description.
  - [ ] **14.3**: Decide the fate of the wiki: populate it with the contribution and governance links, or disable it so it does not look like an abandoned documentation channel.
  - [ ] **14.4**: Evaluate enabling GitHub Discussions as the community venue for questions that are not bugs, given has_issues is True but no discussion area exists.
  - [ ] **14.5**: Gate: topics are non-empty, homepage resolves, and the wiki is either populated or disabled.
- [x] **Step 15 - OSS-15 (medium)**: Contributor attribution was inconsistent: one person committed under three email identities, so git shortlog -sne listed them three times and any future sign-off requirement would have had no single identity to check.
  - [x] **15.1**: Added .mailmap folding emiliano.pisu@webidoo.com and 75838944+pixu1980@users.noreply.github.com into Emiliano Pisu <pisuemiliano.1980@gmail.com>. GitHub's committer-side <noreply@github.com> is deliberately left out, because the web interface performed that commit and folding it would misattribute the action.
  - [x] **15.2**: Verified rather than set: the repository-local user.name and user.email were already the canonical pair, and `git var GIT_AUTHOR_IDENT` confirms it, so new commits add no fourth identity. The global identity points at the work address, which is why the historical one-off commits exist, but the local setting overrides it for this repository.
  - [ ] **15.3**: Documenting the identity and sign-off expectation belongs in CONTRIBUTING.md, which Step 2 creates. Carried there rather than written twice.
  - [x] **15.4**: Gate met: git shortlog -sne reports a single entry covering all 251 commits, where without .mailmap it listed three. No test was added for this one: a guard that shells out to git would fail on a source tarball with no history, and the cost of a fragile test outweighs guarding a file that either folds the aliases or visibly does not.
- [x] **Step 16 - OSS-16 (low)**: The release script reported misleading dry-run totals and 5 of 8 packages omitted an engines field, so the release output and the metadata disagreed with reality.
  - [x] **16.1**: Added a separate wouldRelease counter and extracted the summary into releaseSummaryLines in scripts/release-helpers.mjs, which prints the counter that matches the mode. test/release-helpers.test.mjs asserts both branches, so a dry run can no longer claim it released nothing.
  - [x] **16.2**: Gave all eight packages engines.node >=22.19.0. The sub-step proposed copying pi-cursor's >=22.13.0, and measuring that value showed it is wrong: @earendil-works/pi-coding-agent 0.85.1 declares `node: >=22.19.0` for itself and every package here peers on it, so >=22.13.0 admits a runtime pi cannot load into. pi-cursor was corrected along with the five that had no engines at all.
  - [x] **16.3**: Added test/package-metadata.test.mjs, covering engines, license, repository.directory, the files array, and the LICENSE plus README that the files array must actually ship.
  - [x] **16.4**: Gate met: pnpm release:dry prints 'would release: 8' instead of 'released: 0', pnpm test reports 27 pass 0 fail, and pnpm lint and pnpm format:check both exit 0.
- [x] **Step 17 - OSS-17 (info)**: Accepted risk, recorded by maintainer decision: the repository has no CI, so 0 of 8 packages carry provenance attestations and releases are published from a developer machine with a personal npm credential.
  - [x] **17.1**: Wrote ADR 013, which records the decision, the exposure it accepts, the four alternatives that were considered and rejected, and the three observations that would reopen it: a second maintainer, a consumer who requires provenance, and any reported compromise traceable to a released tarball.
  - [x] **17.2**: Done as part of step 4.3. SECURITY.md states the provenance gap, that tags are lightweight and unsigned, that no CI runs the gates, and that no release-age cooldown is configured. Verified by grep for each statement rather than by reading the file.
  - [x] **17.3**: Recorded the credible bounds in the ADR. Measured the 2FA claim instead of asserting it: npm profile get reports `two-factor auth: auth-and-writes`, so a publish needs a second factor. The other bounds are exact pinned versions, a lockfile and a test suite per package. The dependency cooldown is explicitly not among them, because ADR 012 removed it for the opposite reason.
  - [x] **17.4**: Gate met: ADR 013 is indexed in docs/adr/ADR.md, SECURITY.md states the exposure in three verifiable sentences, and no .github directory exists at all, so no workflow file was added.
- [ ] **Step 18 - OSS-18 (info)**: Accepted risk, recorded by maintainer decision on this run: dependency updates have no automation because .github/dependabot.yml was removed, and dependabot pull request #2 has been open since 2026-09-11.
  - [ ] **18.1**: Close or land dependabot pull request #2 deliberately and record the reason on the pull request, so it stops being an unexplained open item on a repository whose only open issue is that pull request.
  - [ ] **18.2**: Delete the stale remote branch dependabot/npm_and_yarn/packages/pi-mcp/npm_and_yarn-8bd3e5320a once the pull request is resolved.
  - [ ] **18.3**: Document in CONTRIBUTING.md how dependency updates are handled without automation, so the manual process is discoverable rather than absent.
  - [ ] **18.4**: Gate: the repository has zero open pull requests and the stale dependabot remote branch is gone.

- [ ] **Step 19 - OSS-21 (medium)**: Twenty Biome rules are disabled because 167 diagnostics say the code does not satisfy them yet, so the gate passes by ratchet and the backlog is recorded rather than closed.
  - [ ] **19.1**: Fix the correctness subset first, because those are defects and not style: suspicious/noDuplicateObjectKeys (2, in test/harness.mjs), correctness/noUnsafeFinally (2), suspicious/noAssignInExpressions (3), suspicious/noPrototypeBuiltins (1), suspicious/noGlobalIsNan (1), suspicious/noShadowRestrictedNames (1) and suspicious/noImplicitAnyLet (1).
  - [ ] **19.2**: Remove the dead code the linter names: correctness/noUnusedVariables (10), correctness/noUnusedImports (9), correctness/noUnusedFunctionParameters (8) and correctness/noUnusedPrivateClassMembers (3). Check each against the test suites before deleting rather than trusting the rule alone, because a parameter can be part of a signature the caller relies on.
  - [ ] **19.3**: Take the mechanical style rules in one pass so the diff stays reviewable: style/useTemplate (49), style/noNonNullAssertion (36), complexity/useOptionalChain (22), complexity/useLiteralKeys (4), style/useConst (3), complexity/noUselessSwitchCase (3) and style/useImportType (1).
  - [ ] **19.4**: Decide the type-hygiene rules deliberately instead of by default: complexity/noBannedTypes (4) and suspicious/noExplicitAny (4) may be honest escape hatches at a terminal boundary, in which case they stay off with a written reason rather than staying off silently.
  - [ ] **19.5**: Turn each rule back on in biome.json as its count reaches zero, so the ratchet only moves one way and the disabled list shrinks.
  - [ ] **19.6**: Gate: the disabled list in biome.json holds only rules with a written intentional reason, pnpm lint exits 0 with everything else enabled, and pnpm test and pnpm test:all still pass.
