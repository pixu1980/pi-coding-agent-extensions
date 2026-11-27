# sponsors tier plan

- **Role**: maintainer action
- **Date**: 2026-11-27
- **Scope**: `Account settings`. Give the GitHub Sponsors listing a priced tier. Moved out of
  [the oss plan](./oss.md), which closes the remaining findings without it.

Status: `open`.

One step, and only the maintainer can take it. It needs a price decision and a payment account,
so it does not belong in a stream of work that touches files. [FUNDING.md](../../FUNDING.md)
already says what a visitor sees today: a listing with no tier to buy.

- [ ] **ST-T1 - Give the Sponsors listing something to buy.**
  - [ ] **ST-T1.1** Create one priced tier at `https://github.com/sponsors/pixu1980/dashboard`.
        Gate: the GraphQL `sponsorsListing.tiers.totalCount` returns 1 or more.
  - [ ] **ST-T1.2** Name the tier, its price and what it pays for in the "Where to sponsor"
        section of [FUNDING.md](../../FUNDING.md), which currently says no tier exists.

## Manual gates

| Step | Where | Action |
| ---- | ----- | ------ |
| ST-T1.1 | GitHub Sponsors dashboard | Create one priced tier. |
