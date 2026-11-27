# Contributing

This repository publishes eight `@pixu1980/pi-*` packages for the
[pi coding agent](https://pi.dev), plus the deprecated `pi-mcp`. Each one is a
standalone pnpm project; the root is a script runner, not a workspace.

## Local setup

This repository uses **pnpm only**. There is no `packageManager` field, no
`package-lock.json` and no corepack. Three tests in
`test/workspace-config.test.mjs` fail if any of those reappears, so the shape is
enforced rather than remembered. The dependency policy behind it is in
[ADR 012](./docs/adr/012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md).

### How the repository is laid out

Each directory under `packages/` is a **standalone pnpm project**: its own
`package.json`, its own `pnpm-lock.yaml` and its own `pnpm-workspace.yaml`. The
repository root is a **script runner**, not a workspace, which is why its
`pnpm-workspace.yaml` keeps `packages: []` on purpose. Nothing is hoisted, and
nothing installed at the root reaches into a package.

Install and test inside the package you are changing:

```bash
cd packages/<name>
pnpm install
pnpm test
```

The root install only brings in the tooling that lints and releases everything.
That is also why `pnpm test:all` exists: it walks `packages/` and runs each
package's own suite rather than delegating to a workspace command.

### Why the per-package configuration differs

The `overrides` and `allowBuilds` blocks are not identical across packages, and
that is a decision rather than drift. Each package declares the dependencies it
actually resolves, so a package that does not pull in a given transitive
dependency has no reason to carry an override for it. `allowBuilds` is the same
idea applied to build scripts: the entries a package lists are the ones pnpm
reported as ignored in that package's tree, and all of them are `false` because
none is needed at install time.

If you add a dependency and pnpm reports an ignored build script, declare it in
that package's `pnpm-workspace.yaml` with an explicit boolean. Leaving it
undecided is what fails the guard, and pnpm will otherwise write its own
placeholder into the file.

## The gates

There is no CI in this repository, by decision recorded in
[docs/adr/013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md).
Nothing runs the gates for you, so run them yourself before opening a pull
request:

```bash
pnpm test           # the repository's own tests, including the structural guards
pnpm test:all       # every package's suite, in one run
pnpm typecheck:all  # tsc --noEmit in every package that has a typecheck script
pnpm lint           # Biome, over the paths biome.json allows
pnpm format:check   # prettier, over every hand-written source file
```

`pnpm format` rewrites the files in place. Both tools are pinned exactly as root
devDependencies, so a local run and the maintainer's run agree.

`pnpm typecheck:all` walks `packages/` the way `pnpm test:all` does and skips a
package with no `typecheck` script. The host packages are pinned at `^1.6.0` in
each manifest, so the check runs against pi 1.6.x; the reason is in
[ADR 021](./docs/adr/021-pin-the-host-at-1-6-0-and-gate-type-checking-across-all-nine-packages.md).

### The suite must also pass with your git hooks configured

`packages/pi-statusline` commits inside throwaway git repositories. Your global
`core.hooksPath` puts your own `commit-msg` or `pre-commit` hook in front of
those commits, and a hook that rejects the fixture message would fail tests that
have nothing to do with hooks.

Every fixture therefore commits with `git -c core.hooksPath=`, which runs no
hook at all, and
[`_git-hooks.test.mjs`](./packages/pi-statusline/__tests__/_git-hooks.test.mjs)
proves it. Check it when you touch those fixtures:

```bash
cd packages/pi-statusline
GIT_CONFIG_GLOBAL=/path/to/a/gitconfig-with-a-failing-commit-msg pnpm test
```

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
2. Run the gates above and make them pass. There is no CI to do it for you,
   and the maintainer will run them again.
3. Update the affected package's `README.md` if you changed what it documents.
4. Leave `CHANGELOG.md` alone. It is generated at release time from the commits,
   so editing it by hand is work the next release throws away.
5. Explain any new dependency in the pull request description. Versions are
   pinned exactly, so a new dependency is a deliberate addition rather than a
   range to be floated.

Because there is no CI, expect the review to be a conversation rather than a
green check. The maintainer reviews, runs the gates, and merges.

## Dependency updates

Dependabot opens the dependency pull requests. `.github/dependabot.yml` carries
one `npm` entry per supported package directory, on a weekly schedule, and every
entry uses the `npm_and_yarn` group. `pi-mcp` is not listed: it is deprecated and
cannot be released again.

Each package resolves its own lockfile, so a group update arrives as one pull
request per package and is reviewed like any other change:

1. Keep the group in one pull request. Splitting it means running the same
gates several times over the same tree.
2. Run that package's gates, `pnpm test` and `pnpm typecheck` inside it, plus the
   root `pnpm test:all`. A dependency that changes a host type shows up there.
3. Read the changelog of the package that moved. Versions are pinned exactly, so
   the pull request is the whole review: there is no range to float later.
4. If a build script appears in the update, declare it in that package's
   `pnpm-workspace.yaml` with an explicit boolean, as the section above says.

Close an update with a comment rather than silence when the package is
deprecated or the upstream release is not wanted. The next weekly run opens it
again otherwise.

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
