# oss review

- **Role**: oss v1
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. Whole repository: ten package directories, the root, the registry and the GitHub settings.

Status: `complete`.

Findings distilled from [the audit](../audits/oss.md). Each row cites an audit section. Findings
resolved in an earlier run are pruned once they have been shown for a run. The table is this
run's set.

## Lens coverage

| Lens | Findings | Verdict |
| ---- | -------- | ------- |
| Governance a new contributor can find and follow. | OSS-14, OSS-26 | Documents pass. Reach failed and is fixed in this run. |
| Contribution path from first issue to merge, and where it stalls. | OSS-18, OSS-24, OSS-26 | Stalls twice. No human pull request merged. A global git hook breaks 8 tests. |
| CLA or DCO the project asks for, and whether it is enforced. | OSS-25 | Passes as a recorded choice: inbound equals outbound under MIT. |
| Funding transparent to donors and independent of one payer. | OSS-06 | Fails at the last mile: a listing with zero tiers. |
| Release cadence contributors can plan around. | OSS-12, OSS-25 | Cadence is written. Zero release notes exist. |
| Community whose decisions are documented, not remembered. | OSS-12, OSS-14 | 20 ADRs pass. Venues fail: 0 releases, 0 discussions. |
| Boundaries between maintainers and donors, and who decides when they conflict. | OSS-06 | Text passes. Zero tiers mean it is untested. |

## Decisions taken on this run

| Question | Decision | Consumed by |
| -------- | -------- | ----------- |
| Manifests pin host 0.99.1, the running host is 1.6.0. Which pin wins? | Raise the pin to 1.6.0 and supersede ADR 016. | OSS-23 |
| Four of ten packages type-check, no gate runs it. Mandatory? | Yes. Fill the gaps and make `typecheck:all` the fifth gate. | OSS-23 |
| Dependabot has no configuration and one stale pull request. | Commit a scoped `.github/dependabot.yml`. | OSS-18 |
| Zero GitHub Releases for ten published packages. | Automate the note in `release.mjs` and backfill the tags. | OSS-12 |
| Topics, homepage and wiki were unset. Apply them now? | Yes. Applied and verified in audit §5. | OSS-14 |

Decisions still in force from the earlier run: no CI, no provenance (ADR 013), wiki off,
Discussions off, no product roadmap.

## Findings

| Finding | Severity | Status | Evidence | Summary |
| ------- | -------- | ------ | -------- | ------- |
| OSS-04 | high | resolved | audit §5: private vulnerability reporting returns enabled. SECURITY.md returns 200. | The private channel the policy points at is live. Resolved. |
| OSS-06 | high | open | audit §5: sponsors listing is public with zero tiers. | The Sponsor button leads to a page with nothing to buy. |
| OSS-12 | medium | open | audit §7: zero GitHub Releases. No root changelog and no roadmap. | Consumers read tags, not release notes. |
| OSS-14 | medium | open | audit §5: metadata applied. The Discussions decision has no written reason. | One written sentence is missing. |
| OSS-18 | info | open | audit §6: PR #3 is 71 days old and targets the deprecated package. No dependabot config. | The only open item cannot be released. |
| OSS-23 | high | open | audit §9: pin 0.99.1, host 1.6.0, four type-check scripts, no type gate. | The tested host lags the running host. |
| OSS-24 | medium | open | audit §8: 8 of 80 tests fail under a global git hook path. | The suite depends on the contributor's machine. |
| OSS-25 | low | open | audit §7: 75 lightweight and 65 annotated tags. No policy written. | The tag policy is implicit. |
| OSS-26 | info | open | audit §6: two pull requests ever, both by a bot, none merged. | No human pull request has ever merged. |

## Accepted risks

These are not gaps to close. The maintainer accepted them by recorded decision. They are listed so
no reader mistakes silence for an oversight.

- **No CI and no provenance attestation.** Zero of ten packages carry an attestation. Releases run
  from a maintainer machine with a personal credential and 2FA. ADR 013 records the decision.
  SECURITY.md publishes the exposure.
- **Unsigned tags and no DCO.** Tags are annotated and unsigned. `web_commit_signoff_required` is
  false. OSS-25 asks for the policy to be written, not for signing to start.
- **Manual dependency updates.** OSS-18 asks for one config file or one written decision. It does
  not ask for a bot trusted to merge onto a `main` with no CI.
