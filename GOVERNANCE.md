# Governance

How this project makes decisions, who makes them, and what the model costs.
[CONTRIBUTING.md](./CONTRIBUTING.md) says how to contribute; this document says
who decides.

## The model

**One maintainer, with final say.** Emiliano Pisu holds the decision on
everything in this repository: what ships, what the API looks like, what gets
merged, and what gets closed.

This is written down rather than assumed because a newcomer could otherwise read
the presence of issue templates and a pull request template as evidence of a
committee. There is no committee, no vote, and no second reviewer. Naming the
model is more useful than describing an aspiration.

## What has actually happened

The honest starting point for anyone deciding whether to invest time here:

- 253 commits, all from one person across one canonical identity.
- **One pull request has ever been opened** in this repository, by a bot, and it
  is still open. No outside contribution has ever been merged, and there are no
  merge commits in the history at all.

So the path described below is written, not proven. It is what will happen
rather than a description of a working track record, and reading it as the
latter would set the wrong expectation.

## How decisions are made

Every commit on `main` is a decision. Most are small enough that the commit
message is the whole record. A decision gets an Architecture Decision Record
when a future reader would ask why:

- It changes how the repository is built, tested, released or secured.
- It changes the dependency or supply-chain policy.
- It breaks compatibility for a package's users.
- It rejects an option that a reasonable person would have expected to be taken.

Records live in [`docs/adr/`](./docs/adr). The index in
[`docs/adr/ADR.md`](./docs/adr/ADR.md) is generated from the numbered files, so
editing it by hand is work the next generation throws away.

**A record is immutable once accepted.** It is not edited when it turns out to
be wrong, and it is not deleted when it goes stale. It is superseded by a new
record that says so and links back. That is the whole point: the reason a
decision was made stays visible even after the decision has changed, which is
the information a reader usually needs most.

There are 13 records. The ones a newcomer will care about are
[013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md),
which explains why there is no CI, and
[012](./docs/adr/012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md),
which explains the dependency policy.

## A contested decision

The maintainer decides, and the reasoning is written down in the issue or in an
ADR. There is no escalation, because there is nobody to escalate to.

If you disagree with a decision, the useful move is to argue about it in the
open, with the reasoning, before it is made. Once a change is merged the
maintainer still owns it and can reverse it, but a reversal that discards the
argument rather than answering it is a failure of this model, not a feature of
it.

## From issue to merge

The steps and the checklist are in
[CONTRIBUTING.md](./CONTRIBUTING.md#pull-requests). What matters for governance
is the gate, and it is manual:

1. You open an issue or a pull request. There is no triage bot and no automatic
   labeling, so nothing happens until a person reads it.
2. You run the four gates (`pnpm test`, `pnpm test:all`, `pnpm lint`,
   `pnpm format:check`) and report that they pass.
3. The maintainer reads the change, runs the same four gates, and decides.
   There is no CI, by decision recorded in ADR 013, so the only evidence a
   change is sound is the test suite plus a human running it.
4. The maintainer merges, or explains what would need to change.

Nothing merges without a human doing that. That is slower than a green check and
it is the tradeoff this project chose.

## Becoming a maintainer

This project has a bus factor of one, which is a risk to anyone depending on it.
The exit is written down so it is a plan rather than a hope.

A second maintainer is someone who has:

1. **Contributed over time.** More than one pull request, across more than one
   package, with enough history that their judgment is observable.
2. **Reviewed well.** Comments that identify a real problem, or that say a
   change is fine and why, rather than approval by default.
3. **Shown security awareness.** Understands that these packages load into the
   user's agent process, treats the dual-use boundary in
   [SECURITY.md](./SECURITY.md) as real, and would not merge a change that
   quietly widens what a package can reach.
4. **Read the records.** Has enough of `docs/adr/` in their head to know why the
   repository is shaped the way it is.

Meeting those criteria does not create a second maintainer; the existing one
invites it. There is no application process, and nobody is being recruited
today. The criteria are here so that the answer to "how would that even happen"
is not silence.

## Funding and the donor boundary

This project accepts sponsorship through GitHub Sponsors. [FUNDING.md](./FUNDING.md)
states what money pays for and what it will never buy.

The boundary, in one line: **a donor request that conflicts with the
maintainer's judgment loses.** That is not a policy about donors in particular,
it is the same rule that applies to everyone. Sponsorship buys time, and it buys
no say in this repository. The model above says the maintainer decides, and
money does not change that.

What follows from it, said plainly so nobody has to infer it:

- A sponsor asking for a feature gets an answer in the issue tracker, on the
  same merits as anyone else, and the answer may be no.
- A sponsor asking for a review to jump the queue gets told that it will not.
- A sponsor who wants a commitment, a date, or a support agreement is asking
  for something this project does not sell.

The maintainer is also the only person who decides when to decline
sponsorship, and the answer can be yes for reasons that have nothing to do with
the amount. Refusing money is allowed here.

## What this model costs

Stated plainly, because a governance document that only describes itself is not
useful:

- **No CI.** Nothing runs the tests on your change except a person. See
  [ADR 013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md)
  for the decision and its consequences.
- **No provenance.** Releases are published from a maintainer machine with a
  personal npm credential, so npm cannot attest where a tarball came from.
  [SECURITY.md](./SECURITY.md) states what that means for a consumer.
- **One person.** Every decision, review and release waits on the same
  attention. A slow week upstream is a slow week here.
- **One perspective.** There is no second reviewer to catch what the first
  person is blind to, which is why the test suite and the structural guards in
  `test/` carry more weight than they would in a larger project.

## Changing this document

This document describes the model that exists. Changing it is itself a decision
of the kind that needs a record: propose the change in an issue, and if it is
accepted it lands with an ADR that references the model it replaces.
