# 013: Publish locally without CI and accept the provenance gap

- **Date**: 2026-09-16
- **Status**: accepted
- **Tags**: release, supply-chain, npm, ci, policy, oss, provenance
- **Author**: Emiliano Pisu `<pisuemiliano.1980@gmail.com>`

## Context

This repository publishes eight npm packages and runs no CI at all. During the OSS-01 audit the maintainer confirmed that `.github/` had been removed deliberately, that releases are cut from their own machine, and that they want it to stay that way. What that means was measured rather than assumed: all eight packages report zero provenance attestations on the registry, every version tag is a lightweight object rather than an annotated signed one, no `.github/workflows` exists, and scripts/release.mjs runs `npm publish --access public` followed by `git push --follow-tags origin main` locally. The setup works and was used successfully for the 2026-09-15 releases. The cost is that npm cannot attest where a tarball came from, and nothing runs the tests on a change. The alternative is the flow the release skill prescribes: a build job separate from a publish job, `npm stage publish`, a human approving the staged release with 2FA, every action pinned by SHA, tag rulesets and immutable releases. That flow was offered and declined on 2026-09-15.

## Decision

Keep publishing locally with no CI, and stop treating the provenance gap as a gap to be closed. Releases stay a maintainer action performed with the maintainer's own npm credentials against a 2FA-protected account, the test and lint gates stay manual commands, and no workflow file is added. The exposure this accepts is stated where a consumer will actually read it, in SECURITY.md, rather than only in this record.

## Consequences

Buys: one person can cut a release without a runner, a secret store or a third-party action in the release path, which removes the class of attack that targets CI workflows and the tokens they hold. There is no workflow to keep pinned, no cache to poison, and no pipeline that can publish without a human. Costs, stated so a consumer can weigh them: no package carries a provenance attestation, so npm cannot show a signed link between the published tarball and this repository and a consumer who requires provenance must not install these packages; tags are lightweight and unsigned, so a tag alone does not authenticate a release; nothing runs the test suites on a change, so a gate is only ever as good as the maintainer remembering to run it; and a compromise of the maintainer's machine or npm session would go undetected by any automated check. What bounds the exposure is that npm 2FA is set to auth-and-writes, so a publish needs a second factor, that every dependency version is pinned exactly with a lockfile per package, and that each package carries a test suite a consumer can re-run with pnpm test and pnpm test:all. The release-age cooldown is deliberately not among those bounds, because ADR 012 removed it for the opposite reason.

## What would end this

The reasoning assumes a single maintainer publishing from a machine they control, where a release that needs no runner is worth more than an attestation. Three observations would flip that balance. A second maintainer, because a manual gate is only as good as the one person who remembers to run it. A consumer who requires provenance before installing, because the gap then stops being an accepted cost and starts being a reason not to adopt. And any reported compromise traceable to a released tarball, because the absence of an attestation would turn an incident into an investigation with nothing to check. The cheapest one to watch for is the first outside contribution: the moment someone else's work ships through this path, the manual tests stop being only the maintainer's to remember. On any of the three this decision is superseded rather than quietly reversed.

## Alternatives Considered

1. Reintroduce full CI: a test job, a zizmor workflow lint job, and npm Trusted Publishing with staged releases approved by hand. Rejected by the maintainer, who asked for `.github/` to be removed and wants releases driven from their own machine. Recorded here rather than silently dropped.
1. Reintroduce CI for the test and lint gates only, and keep publishing local. Rejected for the same reason: the objection was to the workflow files and the automation, not only to the publish step.
1. Commit the workflow files but leave them disabled until they are wanted. Rejected: it makes the repository look automated while nothing runs, which is harder to reason about than an honest absence.
1. Move to npm Trusted Publishing with no CI at all. Not possible: Trusted Publishing is a CI-to-registry trust relationship, so it requires the workflow this decision rules out. It is the one option that would close the provenance gap without a workflow file, and it cannot exist without one.
