# Releasing

How a new version of any `@pixu1980/pi-*` package leaves this repository and
reaches npm. This describes the procedure as it is, including the parts a
smoother-looking document would leave out.

## Who releases

The maintainer, from their own machine, with their own npm credentials. There
is no CI and no release bot, by decision recorded in
[ADR 013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md).
If you are not the maintainer, this document is read-only for you.

## Preconditions

The run refuses to start unless all of these hold, in this order:

1. **A clean tree.** `pnpm release` exits before doing anything when `git status`
   produces output. Commit or stash first.
2. **Green gates.** Run the same four commands a pull request must pass, because
   nothing will run them for you: `pnpm test`, `pnpm test:all`, `pnpm lint`,
   `pnpm format:check`.
3. **npm authentication.** `npm login` on the release machine, with 2FA. The
   npm account this project publishes from requires two-factor authentication
   for writes.
4. **No cooldown to satisfy.** There used to be a 72-hour release-age delay in
   `.npmrc`. [ADR 012](./docs/adr/012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md)
   removed it, so the newest dependency versions install immediately and a
   release is never scheduled around a delay.

`packages/pi-mcp` used to carry one more requirement. Its
`lib/_app-bridge.bundle.js` is generated, not hand-written: it is rebuilt from
the pinned `@modelcontextprotocol/ext-apps` version by `pnpm build:app-bridge`,
and the suite fails while the committed file is stale. That requirement is now
moot: `pi-mcp` is deprecated, because pi 0.99.0 made MCP support part of the core
agent and the package's own `/mcp` command displaces the built-in `mcp` extension
([ADR 017](./docs/adr/017-deprecate-pi-mcp-in-favor-of-pi-s-built-in-mcp-support.md)).
The release loop skips it, so it is never republished and the bundle never has to
be rebuilt for a release again. The bundle and the script stay in the tree as the
record of [ADR 014](./docs/adr/014-commit-the-app-bridge-browser-bundle-built-by-a-pinned-script.md).

## The procedure

```bash
# See which packages the tool considers release-worthy, without touching anything
pnpm release:dry

# Do it
pnpm release
```

`scripts/release.mjs` walks every package under `packages/` that is neither
private nor deprecated and, for each one, compares its directory against its last
release tag, which is `<package-name>@<current-version>`. Anything that changed
counts as release-worthy **except** `CHANGELOG.md`, which the tool regenerates
every time and which can be rewritten without the package itself gaining
anything. If a tag does not exist yet, that package is treated as an initial
release. A deprecated package is skipped in the same place a private one is, so a
manifest that carries the `deprecated` reason cannot be republished by accident.

For each changed package, in order:

1. `commit-and-tag-version` bumps the semver version from the conventional
   commits, rewrites that package's `CHANGELOG.md`, and creates a new
   `<package-name>@<version>` tag. The tag is lightweight and unsigned.
2. `git push --follow-tags origin main` pushes the tag and the release commit.
3. `npm publish --access public` publishes from the release machine with your
   credentials. There is **no provenance attestation** and there is no staged
   approval: the tarball is on npm as soon as this step returns.

The run stops on the first error it hits. A package that was already published
stays published; rerunning the command resumes from the packages that have not
gone out yet.

## What the versions mean

Semver, decided by the commit types since the last tag:

- `feat` moves the minor number and renders as Features; `fix` moves the patch
  number and renders as Bug Fixes.
- Eight `perf` commits sit in the history and no Performance Improvements section
exists in any of the ten changelogs, so do not rely on `perf` to be visible in a
release note.
- Anything else, including `docs`, `chore`, `refactor` and `style`, moves
  nothing on its own and does not appear. That is
  why [CONTRIBUTING.md](./CONTRIBUTING.md) insists a user-facing change is
  committed as `feat` or `fix`.

The package whose manifest says `0.1.14` today says so because that is what the
last run decided. If you are looking at a version and wondering why, the answer
is the commits between its tag and the previous one.

## Cadence

Releases are cut **on demand, per package, with no fixed calendar**. When the
changes in a package are worth shipping, the maintainer checks the changes with
`pnpm release:dry` and ships with `pnpm release`. There is no release train, no
freeze window, and no batching of packages into a joint release: a package that
has nothing new stays where it is.

Because of that, no schedule is published and none is promised. The versions on
npm are the schedule. If you depend on a package and need to know what changed,
the per-package `CHANGELOG.md` files are the record, and the GitHub Releases
page mirrors them.

## After the publish

The tooling stops at npm. Nothing creates a GitHub Release for the new tag, and
the registry page is the only public signal a release went out. Turning a tag
into a readable release note is a manual step: take the new entries from that
package's `CHANGELOG.md`, create the release from the corresponding
`<package-name>@<version>` tag on GitHub, and paste them in.

Verifying a release for the same reason:

```bash
npm view @pixu1980/<name> version
npm view @pixu1980/<name> dist-tags
```

## First release of a new package

A directory under `packages/` that has no tag yet, a name that is free on the
registry, and a manifest that is not `private` gets an initial release the same
way: the tool treats the missing tag as a reason to release. Publish it once
from the maintainer's machine with `npm publish --access public`, authenticating
interactively with 2FA, and only then set up whatever per-package settings the
account allows. The first tarball carries no provenance, and every one after it
is produced the same way.
