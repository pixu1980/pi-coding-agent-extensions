# oss audit

- **Role**: oss v1
- **Date**: 2026-09-15
- **Scope**: the whole pi-coding-agent-extensions monorepo: the 8 published packages under packages/ plus the repository root (governance, license, release, community, funding surface)

Evidence only: the commands this run executed with their measured values, the files it read,
the sources it consulted. No opinions - those belong in the review.

## 1. How the scope was resolved

The scope string handed to the run was `fai`. It matched nothing in the repository, so it was
resolved with the maintainer before any audit work, who confirmed the whole monorepo.

```console
$ grep -riw fai --include="*.md" --exclude-dir=node_modules .
(no output)
$ git branch -a ; git log --all --format="%s" | grep -i fai
(no output)
$ find /Users/emilianopisu/Projects -maxdepth 4 -iname "*fai*" -not -path "*/node_modules/*"
(no output)
```

`tokensave_tokensave_search` with query `fai` returned only substring false positives on
`failure` (`clearFailure`, `recordFailure`, `ReconnectFailureCallback`). The string is the value
of the `${scope}` placeholder in `pix-galaxy-mcp/src/core/review/template/_lines.js` line 17.

## 2. Environment

```console
$ date
mar 15 set 2026 20:58:51 CEST
$ node --version ; npm --version ; pnpm --version
v26.8.2
11.19.1
11.25.0
$ git remote -v
origin  git@github.com:pixu1980/pi-coding-agent-extensions.git (fetch)
origin  git@github.com:pixu1980/pi-coding-agent-extensions.git (push)
$ git rev-list --count HEAD
236
$ git branch -a
  backup/pre-rewrite
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/dependabot/npm_and_yarn/packages/pi-mcp/npm_and_yarn-8bd3e5320a
  remotes/origin/main
```

## 3. Working tree state at audit time

The tree was not clean and changed during the run. Package manifests carry mtimes of 20:46-20:49,
inside the run window.

```console
$ git status --short
 M package.json
 M packages/pi-ask/package.json
 M packages/pi-cursor/package.json
 M packages/pi-mcp/package.json
 D packages/pi-path-picker/package-lock.json
 M packages/pi-path-picker/package.json
 D packages/pi-reasoning/package-lock.json
 M packages/pi-reasoning/package.json
 M packages/pi-sessions/package.json
 M packages/pi-statusline/package.json
 M packages/pi-web/package.json

$ git diff --stat
 package.json                              |    3 +-
 packages/pi-ask/package.json              |   12 +-
 packages/pi-cursor/package.json           |   16 +-
 packages/pi-mcp/package.json              |   34 +-
 packages/pi-path-picker/package-lock.json | 2336 ----------------------------
 packages/pi-path-picker/package.json      |    8 +-
 packages/pi-reasoning/package-lock.json   | 2324 ----------------------------
 packages/pi-reasoning/package.json        |    8 +-
 packages/pi-sessions/package.json         |   10 +-
 packages/pi-statusline/package.json       |   12 +-
 packages/pi-web/package.json              |   14 +-
 11 files changed, 58 insertions(+), 4719 deletions(-)

$ stat -f "%Sm %N" -t "%Y-%m-%d %H:%M" package.json packages/*/package.json
2026-09-15 20:46 package.json
2026-09-15 20:48 packages/pi-mcp/package.json
2026-09-15 20:48 packages/pi-path-picker/package.json
2026-09-15 20:48 packages/pi-reasoning/package.json
2026-09-15 20:48 packages/pi-sessions/package.json
2026-09-15 20:48 packages/pi-statusline/package.json
2026-09-15 20:48 packages/pi-web/package.json
2026-09-15 20:49 packages/pi-ask/package.json
2026-09-15 20:49 packages/pi-cursor/package.json
```

Diff content, representative sample:

```diff
--- a/package.json
+++ b/package.json
@@
-  "packageManager": "pnpm@11.18.0",
@@
-    "commit-and-tag-version": "^13.1.2"
+    "commit-and-tag-version": "13.2.1"

--- a/packages/pi-ask/package.json
+++ b/packages/pi-ask/package.json
@@
-    "@earendil-works/pi-coding-agent": ">=0.83.0",
-    "@earendil-works/pi-tui": ">=0.83.0",
+    "@earendil-works/pi-coding-agent": ">=0.85.1",
+    "@earendil-works/pi-tui": ">=0.85.1",
@@
-    "@types/node": "^26.1.2",
-    "commit-and-tag-version": "13.1.2",
-    "tsx": "4.23.1",
-    "typescript": "^7.0.2"
+    "@types/node": "26.6.0",
+    "commit-and-tag-version": "13.2.1",
+    "tsx": "4.23.13",
+    "typescript": "7.0.2"

--- a/packages/pi-web/package.json
+++ b/packages/pi-web/package.json
@@
-    "typebox": "1.3.9"
+    "typebox": "1.3.31"
@@
-    "@earendil-works/pi-coding-agent": "0.83.0",
+    "@earendil-works/pi-coding-agent": "0.85.1",
```

The maintainer confirmed on this run that the bump is intentional and uncommitted.

## 4. Test and release baseline (measured)

```console
$ pnpm test
✔ every extension ships a structured, accessible SVG banner (7.767625ms)
✔ runs the repository-installed commit-and-tag-version binary (0.628542ms)
✔ adds dry-run when requested (0.0825ms)
✔ keeps the configured version for an untagged first release (0.061584ms)
✔ checks npm authentication without logging in when already authenticated (0.450084ms)
✔ asks the user to log in when npm authentication is missing (0.11825ms)
✔ fails when npm login does not authenticate the user (0.226625ms)
✔ publishes packages locally from the release process (0.649917ms)
✔ isReleaseTriggerFile ignores auto-generated CHANGELOG.md (0.174792ms)
✔ CHANGELOG.md-only changes do not trigger a release (the last-run bug) (866.4425ms)
✔ source changes since the last tag do trigger a release (1574.067958ms)
✔ changes in other packages do not trigger a release (663.670833ms)
✔ unknown tag returns null (caller errs on the side of releasing) (421.813375ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0

$ pnpm test:all
═══ test-all  ═══
── pi-ask: node --import tsx --test __tests__/index.test.mjs ✅
    ℹ tests 101 | ℹ pass 101 | ℹ fail 0
── pi-cursor ✅          ℹ tests 166 | ℹ pass 166 | ℹ fail 0
── pi-mcp ✅             ℹ tests 42 | ℹ pass 42 | ℹ fail 0
── pi-path-picker ✅     ℹ tests 42 | ℹ pass 42 | ℹ fail 0
── pi-reasoning ✅       ℹ tests 59 | ℹ pass 59 | ℹ fail 0
── pi-sessions ✅        ℹ tests 34 | ℹ pass 34 | ℹ fail 0
── pi-statusline ✅      ℹ tests 65 | ℹ pass 65 | ℹ fail 0
── pi-web ✅             ℹ tests 28 | ℹ pass 28 | ℹ fail 0
═══ risultato: 8 ok, 0 falliti ═══
```

Measured total: 101+166+42+42+59+34+65+28 = 537 package tests, all passing, plus 13 root tests.

```console
$ pnpm release:dry   (tail; package order is alphabetical, so pi-web is last)
── @pixu1980/pi-web ────────────────────────────────
   current version: 0.1.7
   tag found: @pixu1980/pi-web@0.1.7
   ↻ release-worthy changes detected (1):
       packages/pi-web/package.json
   [dry-run] commit-and-tag-version --tag-prefix "@pixu1980/pi-web@"
✔ bumping version in package.json from 0.1.7 to 0.1.8
✔ outputting changes to CHANGELOG.md
✔ committing package.json and CHANGELOG.md
✔ tagging release @pixu1980/pi-web@0.1.8
═══════════════════════════════════════════
  Summary:
  • released:     0
  • skipped:      0
  • total pkgs:   8
```

All 8 packages are detected as release-worthy, because the uncommitted manifest bump touches every
`packages/*/package.json`. The non-dry path refuses to run on a dirty tree:

```console
$ grep -n "Working tree is not clean" scripts/release.mjs
117:    console.error('✗ Working tree is not clean. Commit or stash before releasing.');
```

## 5. License compliance

```console
$ for d in packages/*/; do printf "  %-18s LICENSE:%s\n" "$(basename $d)" \
    "$([ -f $d/LICENSE ] && echo yes || echo MISSING)"; done
  pi-ask             LICENSE:MISSING
  pi-cursor          LICENSE:MISSING
  pi-mcp             LICENSE:yes
  pi-path-picker     LICENSE:MISSING
  pi-reasoning       LICENSE:MISSING
  pi-sessions        LICENSE:MISSING
  pi-statusline      LICENSE:MISSING
  pi-web             LICENSE:yes
```

The root `LICENSE` is the `MIT` license, `Copyright (c) 2026 Emiliano "pixu1980" Pisu`.

Published tarball contents, read from the registry:

```console
$ tar tzf pi-ask.tgz
     package/package.json
     package/README.md
     package/lib/banner.svg
     package/lib/_ask.ts
     package/lib/_commands.ts
     package/lib/_interview-tool.ts
     package/lib/_lang.ts
     package/lib/_logic.ts
     package/lib/_path-provider.ts
     package/lib/_types.ts
     package/index.ts
     package/lib/index.ts
     (no LICENSE)

$ tar tzf pi-statusline.tgz
     package/package.json
     package/CHANGELOG.md
     package/README.md
     ...
     (no LICENSE)

$ tar tzf pi-mcp.tgz
     package/DISCLOSURE
     package/LICENSE
     package/lib/_app-bridge.bundle.js
     package/lib/_cli.js
     package/package.json
     ...
```

Measured `files` arrays: `pi-ask`, `pi-path-picker`, `pi-reasoning` and `pi-sessions` declare
`["index.ts","lib/**","README.md"]` with no `LICENSE` entry; `pi-statusline` adds `CHANGELOG.md`
but still no `LICENSE`; `pi-cursor` adds `DISCLOSURE` but no `LICENSE`. Only `pi-mcp` and `pi-web`
list `LICENSE`.

## 6. Community health profile (GitHub API)

```console
$ curl -s https://api.github.com/repos/pixu1980/pi-coding-agent-extensions/community/profile
  health_percentage: 42
  code_of_conduct: MISSING
  code_of_conduct_file: MISSING
  contributing: MISSING
  issue_template: MISSING
  pull_request_template: MISSING
  license: https://api.github.com/licenses/mit
  readme: https://api.github.com/repos/pixu1980/pi-coding-agent-extensions/contents/README.md

$ curl -s https://api.github.com/repos/pixu1980/pi-coding-agent-extensions
  private: False
  description: Monorepo for Pi.dev extensions
  homepage: None
  license: MIT
  has_issues: True
  has_projects: False
  has_discussions: False
  has_wiki: True
  has_pages: False
  open_issues_count: 1
  forks_count: 0
  stargazers_count: 5
  watchers_count: 5
  default_branch: main
  created_at: 2026-06-28T09:11:54Z
  pushed_at: 2026-09-15T18:35:27Z
  topics: []
  allow_forking: True
  web_commit_signoff_required: False

$ curl -s -o /dev/null -w "%{http_code}" .../contents/.github/ISSUE_TEMPLATE
404
$ curl -s .../releases                                 -> count: 0
$ curl -s -o /dev/null -w "%{http_code}" .../branches/main/protection
401   (cannot be read unauthenticated)
```

Governance-relevant file presence at the repository root:

```console
$ for f in CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md GOVERNANCE.md \
           MAINTAINERS.md AUTHORS CONTRIBUTORS NOTICE CHANGELOG.md \
           FUNDING.yml .github .gitattributes .editorconfig LICENSE; do
    [ -e "$f" ] && echo "  PRESENT  $f" || echo "  MISSING  $f"; done
  MISSING  CONTRIBUTING.md
  MISSING  CODE_OF_CONDUCT.md
  MISSING  SECURITY.md
  MISSING  GOVERNANCE.md
  MISSING  MAINTAINERS.md
  MISSING  AUTHORS
  MISSING  CONTRIBUTORS
  MISSING  NOTICE
  MISSING  CHANGELOG.md
  MISSING  FUNDING.yml
  MISSING  .github
  MISSING  .gitattributes
  MISSING  .editorconfig
  PRESENT  LICENSE
```

Issue and pull-request history, plus authorship:

```console
$ curl -s ".../issues?state=all&per_page=20"
  #2 [open] chore(deps): bump @vitest/mocker from 4.1.10 to 5.0.0 in
     /packages/pi-mcp in the npm_and_yarn group across 0 directory  (2026-09-11) PR
  #1 [closed] Change master branch to main  (2026-06-28) ISSUE

$ git log --merges --oneline | wc -l
       0
$ git log --format="%aE" | sort | uniq -c | sort -rn
 234 pisuemiliano.1980@gmail.com
   1 emiliano.pisu@webidoo.com
   1 75838944+pixu1980@users.noreply.github.com
```

## 7. Documentation and decision record

```console
$ ls docs/
adr  handoff

$ ls docs/adr/
001-stale-while-revalidate-for-statusline-render-path-caches.md
002-async-secret-command-resolution-in-pi-mcp.md
003-read-through-metadata-cache-for-pi-mcp.md
004-bounded-session-discovery-in-pi-sessions.md
005-cache-counters-and-explicit-invalidation-contracts.md
006-bounded-concurrent-reconnect-and-coalesced-panel-renders.md
007-lazy-startup-graph-verified-by-bench-in-pi-mcp.md
008-make-the-pi-sessions-listing-cache-filesystem-free-with-explicit-invalidation.md
009-publish-the-local-cursor-model-catalog-to-the-sdk-instead-of-relying-on-the-clou.md
010-keep-a-free-plan-model-discovery-failure-off-the-startup-banner.md
ADR.md

$ ls docs/handoff/
01-performance-optimization-execution.md
02-pi-cursor-extension.md
03-performance-run-and-roadmap-close.md
04-house-style-pass-and-cursor-free-plan.md

$ for d in plans reviews audits; do
    [ -d docs/$d ] && echo "docs/$d present" || echo "docs/$d MISSING"; done
docs/plans MISSING
docs/reviews MISSING
docs/audits MISSING

$ wc -l README.md packages/*/README.md
      46 packages/pi-statusline/README.md
      47 README.md
     572 packages/pi-mcp/README.md
    1665 total

$ grep -nE "^#{1,4} " README.md
1:# pi-coding-agent-extensions
5:## Structure
18:## Publishing
37:## Development
45:## License
```

README heading coverage per package, showing which carry a security section:

```console
$ for d in packages/*/; do printf "%-18s" "$(basename $d)"; \
    grep -iE "^#{1,3} .*(contribut|securit|support|license|funding)" "$d/README.md" | tr '\n' ' '; echo; done
pi-ask              ## License
pi-cursor           ## License
pi-mcp
pi-path-picker      ## License
pi-reasoning        ## License
pi-sessions         ## License
pi-statusline       ## License
pi-web              ## Security ## License
```

## 8. Repository structure, tooling and lockfiles

```console
$ cat pnpm-workspace.yaml
packages: []

overrides:
  'brace-expansion@<5': ^1.1.17
  'brace-expansion@>=5': ^5.0.9

$ grep -A6 "^importers:" pnpm-lock.yaml
importers:

  .:
    devDependencies:
      commit-and-tag-version:
        specifier: 13.2.1
        version: 13.2.1(...)

$ find . -maxdepth 3 \( -name "*-lock.*" -o -name "pnpm-workspace.yaml" \) -not -path "*/node_modules/*" | sort
./packages/pi-ask/pnpm-lock.yaml
./packages/pi-ask/pnpm-workspace.yaml
./packages/pi-cursor/pnpm-lock.yaml
./packages/pi-cursor/pnpm-workspace.yaml
./packages/pi-mcp/pnpm-lock.yaml
./packages/pi-mcp/pnpm-workspace.yaml
./packages/pi-path-picker/pnpm-lock.yaml
./packages/pi-path-picker/pnpm-workspace.yaml
./packages/pi-reasoning/pnpm-lock.yaml
./packages/pi-reasoning/pnpm-workspace.yaml
./packages/pi-sessions/pnpm-lock.yaml
./packages/pi-sessions/pnpm-workspace.yaml
./packages/pi-statusline/pnpm-lock.yaml
./packages/pi-statusline/pnpm-workspace.yaml
./packages/pi-web/pnpm-lock.yaml
./packages/pi-web/pnpm-workspace.yaml
./pnpm-lock.yaml
./pnpm-workspace.yaml
```

Each of the 8 packages carries its own `pnpm-workspace.yaml`. Their contents diverge: 4 carry
`overrides`, 4 carry `allowBuilds`, and none matches the root.

```console
$ pnpm format
$ prettier --write 'packages/*/src/**/*.ts'
[error] No files matching the pattern were found: "packages/*/src/**/*.ts".
[ELIFECYCLE] Command failed with exit code 2.
$ ls -d packages/*/src
(no output)
$ python3 -c "import json;print(json.load(open('package.json'))['devDependencies'])"
{'commit-and-tag-version': '13.2.1'}
$ grep -n '"lint"' package.json
    "lint": "echo 'No linter configured yet'",
```

`prettier` is not installed and `packages/*/src` does not exist. The `lint` script is a no-op.
No package defines a `build` script:

```console
$ python3 -c "import json,glob
for f in sorted(glob.glob('packages/*/package.json')):
    print(f, list(json.load(open(f)).get('scripts',{}).keys()))"
packages/pi-ask/package.json         ['test','test:coverage','release','release:dry']
packages/pi-cursor/package.json      ['test','test:coverage','typecheck','release','release:dry']
packages/pi-mcp/package.json         ['test','bench','test:watch','test:coverage']
packages/pi-path-picker/package.json ['test','release','release:dry','test:coverage']
packages/pi-reasoning/package.json   ['test','release','release:dry','test:coverage']
packages/pi-sessions/package.json    ['release','release:dry','test','test:coverage']
packages/pi-statusline/package.json  ['release','release:dry','test','bench','test:coverage']
packages/pi-web/package.json         ['test','typecheck','release','release:dry','test:coverage']
```

## 9. Unfilled configuration placeholders

```console
$ grep -rn "set this to true or false" --exclude-dir=node_modules .
  ./docs/handoff/04-house-style-pass-and-cursor-free-plan.md:81:  pi-web (`set this to true or false`); pi-cursor declares `false`.
  ./packages/pi-path-picker/pnpm-workspace.yaml:2:  '@google/genai': set this to true or false
  ./packages/pi-path-picker/pnpm-workspace.yaml:3:  esbuild: set this to true or false
  ./packages/pi-path-picker/pnpm-workspace.yaml:4:  protobufjs: set this to true or false
  ./packages/pi-web/pnpm-workspace.yaml:2:  '@google/genai': set this to true or false
  ./packages/pi-web/pnpm-workspace.yaml:3:  esbuild: set this to true or false
  ./packages/pi-web/pnpm-workspace.yaml:4:  protobufjs: set this to true or false
  ./packages/pi-ask/pnpm-workspace.yaml:2:  '@google/genai': set this to true or false
  ./packages/pi-ask/pnpm-workspace.yaml:3:  esbuild: set this to true or false
  ./packages/pi-ask/pnpm-workspace.yaml:4:  protobufjs: set this to true or false

$ cat packages/pi-ask/pnpm-workspace.yaml
allowBuilds:
  '@google/genai': set this to true or false
  esbuild: set this to true or false
  protobufjs: set this to true or false

$ cat packages/pi-cursor/pnpm-workspace.yaml
# Build scripts explicitly declined: pi-cursor needs none of them at install
# time. Declaring them (instead of leaving pnpm to guess) keeps `pnpm test`
# from failing on the ignored-builds check.
allowBuilds:
  '@google/genai': false
  esbuild: false
  protobufjs: false
```

12 placeholder lines across `pi-ask`, `pi-path-picker` and `pi-web`.
`pnpm install --lockfile-only --dry-run` in `pi-ask` exits 0, so the misconfigured values are not
rejected.

## 10. Supply chain and release surface

```console
$ curl -s "https://registry.npmjs.org/@pixu1980/$p" | python3 ...   # per package
@pixu1980/pi-ask         latest 0.1.14  attestations: NO
@pixu1980/pi-cursor      latest 0.1.1   attestations: NO
@pixu1980/pi-mcp         latest 0.1.15  attestations: NO
@pixu1980/pi-path-picker latest 0.1.25  attestations: NO
@pixu1980/pi-reasoning   latest 0.2.14  attestations: NO
@pixu1980/pi-sessions    latest 0.1.15  attestations: NO
@pixu1980/pi-statusline  latest 0.1.14  attestations: NO
@pixu1980/pi-web         latest 0.1.7   attestations: NO
```

0 of 8 packages carry a provenance attestation. The publish path is local:

```console
$ grep -n "npm publish" scripts/release.mjs
     execIn(pkgPath, `npm publish --access public`, { stdio: 'inherit' });
$ grep -n "git push" scripts/release.mjs
     execIn(pkgPath, `git push --follow-tags origin main`, { stdio: 'inherit' });
```

Tag format and signing:

```console
$ git for-each-ref refs/tags --format='%(refname:short) %(objecttype)' | head -3
@pixu1980/pi-ask@0.1.0 commit
@pixu1980/pi-ask@0.1.1 commit
@pixu1980/pi-ask@0.1.10 commit
```

All tags are lightweight (`commit`), none is annotated and signed.

Cooldown and local supply-chain settings, which are configured:

```console
$ cat .npmrc
# Registry e permessi di pubblicazione sono espliciti e pubblici.
registry=https://registry.npmjs.org/
access=public

# Supply-chain security: 3-day cooldown before using newly published dependency versions.
# Blocca ~94% dei pacchetti malevoli (median takedown time: 14 ore).
# Richiede pnpm >= 11.
minimumReleaseAge=4320

$ (cd packages/pi-ask && pnpm install --lockfile-only --dry-run) | head -1
✓ Lockfile passes supply-chain policies (verified 3h ago)
```

Vulnerability scanning reachable from the repository:

```console
$ (cd packages/pi-ask && npm audit)
npm error code ENOLOCK
npm error audit This command requires an existing lockfile.
npm error audit Try creating one first with: npm i --package-lock-only

$ pnpm audit
{ "advisories": {}, "metadata": { "vulnerabilities": { "info": 0, ...
```

The committed, published generated artifact:

```console
$ git ls-files packages/pi-mcp/lib/_app-bridge.bundle.js
packages/pi-mcp/lib/_app-bridge.bundle.js
$ ls -la packages/pi-mcp/lib/_app-bridge.bundle.js
-rw-r--r--  1 emilianopisu  staff  295508  7 ago 13:02 packages/pi-mcp/lib/_app-bridge.bundle.js
$ wc -l packages/pi-mcp/lib/_app-bridge.bundle.js
       1 packages/pi-mcp/lib/_app-bridge.bundle.js
$ grep -c "app-bridge.bundle" packages/pi-mcp/lib/_host-html-template.ts packages/pi-mcp/lib/_ui-server.ts
packages/pi-mcp/lib/_host-html-template.ts:1
packages/pi-mcp/lib/_ui-server.ts:1
```

The file is one single 295508-byte line, so it is minified with no formatting at all. It is
referenced by `DEFAULT_APP_BRIDGE_MODULE_URL` at `_host-html-template.ts` line 4 and served from
`_ui-server.ts` line 362, and it ships inside the npm tarball as `package/lib/_app-bridge.bundle.js`
through the `lib/**` glob.

No script in the repository produces it: no package defines a `build` script and no bundler config
is present.

## 11. Package metadata

```console
$ python3 - < scan of packages/*/package.json
name                      ver      priv  lic   engines                dual     files#
@pixu1980/pi-ask          0.1.14   False MIT   None                   None     3
@pixu1980/pi-cursor       0.1.1    False MIT   {'node': '>=22.13.0'}  dual-use 4
@pixu1980/pi-mcp          0.1.15   False MIT   {'node': '>=20'}       dual-use 6
@pixu1980/pi-path-picker  0.1.25   False MIT   None                   None     3
@pixu1980/pi-reasoning    0.2.14   False MIT   None                   None     3
@pixu1980/pi-sessions     0.1.15   False MIT   None                   None     3
@pixu1980/pi-statusline   0.1.14   False MIT   None                   None     4
@pixu1980/pi-web          0.1.7    False MIT   {'node': '>=20'}       dual-use 5
```

5 of 8 packages declare no `engines` field. All 8 declare `license: MIT`, a `repository` with a
`directory` pointer, `homepage`, `bugs` and `keywords`. No `package.json` anywhere declares
`funding`. `DISCLOSURE` presence:

```console
$ for d in packages/*/; do printf "  %-18s DISCLOSURE:%s\n" "$(basename $d)" \
    "$([ -f $d/DISCLOSURE ] && echo yes || echo no)"; done
  pi-ask             DISCLOSURE:no
  pi-cursor          DISCLOSURE:yes
  pi-mcp             DISCLOSURE:yes
  pi-path-picker     DISCLOSURE:no
  pi-reasoning       DISCLOSURE:no
  pi-sessions        DISCLOSURE:no
  pi-statusline      DISCLOSURE:no
  pi-web             DISCLOSURE:yes
```

The three packages declaring `contentPolicy: dual-use` are `pi-cursor`, `pi-mcp` and `pi-web`, and
each has a `DISCLOSURE` file.

## 12. Language rule compliance

The project's own rule is that every artifact except chat is written in English. Matching
non-English prose in repository-owned files:

```console
$ grep -rniE "\b(risultato|falliti|errore|senza|attenzione)\b" \
    --include="*.mjs" --include="*.ts" --include="*.md" --include=".npmrc" \
    scripts/ packages/*/lib packages/*/README.md README.md .npmrc
.npmrc:1:# Registry e permessi di pubblicazione sono espliciti e pubblici.
packages/pi-path-picker/lib/_provider.ts:121:      // Nessun token di percorso (o "~" senza slash) chiude eventuali menu
packages/pi-path-picker/lib/_provider.ts:122:      // aperti, senza passare dal provider nativo.

$ grep -n "risultato\|falliti" scripts/test-all.mjs
86:console.log(`\n═══ risultato: ${pass} ok, ${fail} falliti ═══`);
88:  console.log("falliti:", failures.join(", "));
```

## 13. Files read

Repository-owned: `README.md`, `LICENSE`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`.npmrc`, `.gitignore`, `.prettierrc`, `scripts/release.mjs`, `scripts/release-helpers.mjs`,
`scripts/test-all.mjs`, `test/release-helpers.test.mjs`, `docs/adr/ADR.md`,
`docs/handoff/04-house-style-pass-and-cursor-free-plan.md`, all 8 `packages/*/package.json`, all 8
`packages/*/pnpm-workspace.yaml`, and a per-package `README.md` heading scan.

Out of scope, read solely to resolve the scope string:
`pix-galaxy-mcp/src/core/review/template/_lines.js`, `_fill.js`, `_operation.js`.

## 14. Web sources consulted

- OpenSSF Scorecard checks, `https://raw.githubusercontent.com/ossf/scorecard/main/docs/checks.md`
  - 20 checks, used as the external yardstick for CI-Tests, Security-Policy, License, Packaging,
  Signed-Releases, Dependency-Update-Tool and Contributors.
- npm Trusted Publishing, `https://docs.npmjs.com/trusted-publishers` - the stage-then-approve flow
  and provenance attestations.
- GitHub community profiles,
  `https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories`
  - the file set behind the measured `health_percentage`.
- GitHub private vulnerability reporting,
  `https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/configuring-private-vulnerability-reporting-for-a-repository`
- GitHub sponsor button and `FUNDING.yml`,
  `https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository`
- Contributor Covenant, `https://www.contributor-covenant.org/version/3/0/code_of_conduct/` -
  HTTP 200, current major version 3.
- Developer Certificate of Origin, `https://developercertificate.org/` - version 1.1 text.
- Open Source Guides, `https://opensource.guide/leadership-and-governance/` - decision-making
  models and role ladders.

## Out of scope observations

- Scope resolution required reading `pix-galaxy-mcp` template sources; no finding is reported
  against them.
- The environment changed outside this scope: `~/.pi/agent/settings.json` was edited earlier in the
  same session to install the 8 packages globally, and `.pi/settings.json` was emptied. Recorded
  once, not investigated.
