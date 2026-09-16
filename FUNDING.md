# Funding

This project has no funding and one maintainer. This document says what
sponsorship would pay for, what it would never buy, and who decides when the two
disagree.

## What money pays for

Time. That is the whole of it.

There is no hosting bill, no runner to pay for, no infrastructure behind these
packages: npm hosting is free, there is no CI by decision recorded in
[ADR 013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md),
and the tests run on the maintainer's own machine. So a sponsorship does not
keep a service alive. It buys hours that would otherwise be spent elsewhere,
which is the honest description of what a single-maintainer project needs.

Because of that, sponsorship does not unlock anything. Nothing here is gated
behind it.

## What money does not buy

Sponsorship is not a customer relationship. Specifically, it does not buy:

- **Roadmap priority.** A sponsor's feature request is weighed on the same
  merits as anyone else's, in the same issue tracker.
- **Review priority.** Pull requests are read in the order they arrive, not in
  the order of who paid.
- **A commitment to ship anything.** Sponsoring a package does not oblige the
  maintainer to keep it alive, to fix a bug by a date, or to implement a
  requested change.
- **Support.** There is no support agreement here. [SECURITY.md](./SECURITY.md)
  names a channel for vulnerabilities with a response target; that target is
  the same whether or not you sponsor.
- **Influence over decisions.** [GOVERNANCE.md](./GOVERNANCE.md) says the
  maintainer decides. Money does not move that, and the whole point of writing
  it down is that neither party is surprised later.

If you need any of those, sponsorship is the wrong instrument. A support
contract with someone who can commit to them is the right one, and this project
is not offering that.

## What sponsorship does not change

Nothing in the governance of this project.

- The license stays `MIT` ([LICENSE](./LICENSE)). Sponsored or not, the code is
  granted on the same terms.
- The decision model stays as [GOVERNANCE.md](./GOVERNANCE.md) describes.
- ADRs stay public. Sponsored or not, the reasoning behind a decision is
  visible.

## Where to sponsor

GitHub Sponsors, offered through the Sponsor button on this repository:
[the Sponsors page](https://github.com/sponsors/pixu1980).

There is no other channel. The project asks nowhere else and accepts nothing by
other means.

## If the funding model changes

This document describes a project that is unfunded and intends to stay simple.
A change that made money material to how the project works, such as paying
someone to maintain a package, would be a decision of the kind
[GOVERNANCE.md](./GOVERNANCE.md) says needs an ADR, and this file would be
updated alongside it rather than quietly.
