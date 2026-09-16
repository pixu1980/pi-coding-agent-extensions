# Contributing

This repository publishes eight `@pixu1980/pi-*` packages for the
[pi coding agent](https://pi.dev). Each one is a standalone pnpm project; the
root is a script runner, not a workspace.

## Local setup

This repository uses **pnpm only**. There is no `packageManager` field, no
`package-lock.json` and no corepack, and that is deliberate: see
[docs/adr/012](./docs/adr/012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md)
for the dependency policy and the `biome.json` comment for the shape.

Each package installs and runs on its own:

```bash
cd packages/<name>
pnpm install
pnpm test
```

Installing from the repository root only installs the tooling that lints and
releases everything. If you run `npm install` inside a package you will create a
`package-lock.json` and a CI-equivalent check will fail; delete it and use pnpm.

## The gates

There is no CI in this repository, by decision recorded in
[docs/adr/013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md).
Nothing runs the gates for you, so run them yourself before opening a pull
request:

```bash
pnpm test          # the repository's own tests, including the structural guards
pnpm test:all      # every package's suite, in one run
pnpm lint          # Biome, over the paths biome.json allows
pnpm format:check  # prettier, over every hand-written source file
```

`pnpm format` rewrites the files in place. Both tools are pinned exactly as root
devDependencies, so a local run and the maintainer's run agree.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org), and
the scope names the package you changed:

```
fix(pi-path-picker): keep the picker open when a directory is empty
feat(pi-statusline): show context usage as a percentage
```

**This matters more here than in most repositories.** Changelogs are generated
from commit messages by `commit-and-tag-version` when a package is released, and
what it renders is narrower than the commit history suggests:

| Type | Appears in the changelog as |
| ---- | --------------------------- |
| `feat` | Features |
| `fix` | Bug Fixes |
| everything else | nothing at all |

Eight `perf` commits sit in the history and no Performance Improvements section
exists in any changelog, so `perf` does not earn an entry here either.

`docs`, `chore`, `refactor`, `style`, `test`, `build` and `ci` are read by the
tool and then discarded. So a bug fix written as `chore(pi-ask): fix the
parsing` never reaches a release note, and the users who needed it will not
learn that it shipped. If a change is worth a user noticing, its type is `feat`
or `fix`.

No commit-message hook enforces this. Nothing will stop you; the changelog will
simply be wrong.

## Pull requests

1. Branch from `main` and keep the change to one concern where you can.
2. Run the four gates above and make them pass. There is no CI to do it for you,
   and the maintainer will run them again.
3. Update the affected package's `README.md` if you changed what it documents.
4. Leave `CHANGELOG.md` alone. It is generated at release time from the commits,
   so editing it by hand is work the next release throws away.
5. Explain any new dependency in the pull request description. Versions are
   pinned exactly, so a new dependency is a deliberate addition rather than a
   range to be floated.

Because there is no CI, expect the review to be a conversation rather than a
green check. The maintainer reviews, runs the gates, and merges.

## Releases

Only the maintainer cuts a release. The procedure, the preconditions and the
cadence are in [RELEASING.md](./RELEASING.md): a release goes out on demand for
the packages whose release-worthy files changed, with no fixed calendar.
Nothing you do in a pull request triggers or configures one.

## Contribution terms

Contributions are accepted **inbound=outbound under the `MIT` license**. By
submitting a pull request you agree that your contribution is licensed to this
project under the same terms it will be distributed under.

There is **no CLA and no DCO**. You are not asked to sign anything and you are
not asked to add a `Signed-off-by` line. That is a deliberate choice rather than
an oversight: the project has a single maintainer, it does not relicense
contributions, and a sign-off requirement would add friction that buys nothing
here. If either assumption changes, this paragraph is where it will be said.

## Identity and sign-off

Commit under a consistent name and email. If you contribute from more than one
address, add the extra ones to [`.mailmap`](./.mailmap) so `git shortlog` and
the contributors view report you once instead of once per address:

```
Your Name <primary@example.com> <other@example.com>
```

No sign-off line is required, for the reason above.

## Conduct

Everyone participating in this project is expected to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md), which also states how a report is made
and what happens after one.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](./SECURITY.md)
names the private channel, the supported versions and the trust boundary of each
package.
