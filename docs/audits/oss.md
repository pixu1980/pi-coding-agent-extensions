# oss audit

- **Role**: oss v1
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. The topic named no narrower surface. The run audited the ten package directories, the root, the registry state and the GitHub settings.

Status: `complete`.

Evidence only: the commands this run executed with their values, the files it read and the
sources it consulted. Opinions belong in [the review](../reviews/oss.md).

## 1. Environment

```console
$ date -u
ven 27 nov 2026 11:50:27 UTC
```

```console
$ node --version ; npm --version ; pnpm --version
v26.13.1
11.20.0
12.23.0
```

```console
$ pi --version
1.6.0
$ git rev-list --count HEAD ; git tag --list | wc -l
323
140
```

The host that runs these extensions is `pi` 1.6.0. Every manifest pins
`@earendil-works/pi-coding-agent` 0.99.1 in `devDependencies` (§9).

## 2. Working tree

```console
$ git status --porcelain
(no output)
$ git status -sb | head -1
## main...origin/main
```

```console
$ git log --format='%B' | grep -c "Signed-off-by"
1
$ git log --merges --oneline | wc -l
0
```

323 commits: 35 `feat`, 8 `perf`. `CONTRIBUTING.md` line 87 and `RELEASING.md`
line 81 both say "Eight `perf` commits", which still matches.

## 3. Package inventory

```console
$ ls -d packages/*/ | wc -l
10
```

Fields read from each `package.json`.

- `pi-ask` 0.1.18, published, MIT, engines `>=22.19.0`, 9 keywords.
- `pi-cursor` 0.1.5, published, `dual-use`, ships `DISCLOSURE`, 8 keywords.
- `pi-lyceum` 0.1.0, published, `dual-use`, ships `DISCLOSURE`, 9 keywords.
- `pi-mcp` 0.1.17, `private: true`, `deprecated: true`, `dual-use`, ships `DISCLOSURE`.
- `pi-path-picker` 0.1.29, published, 8 keywords.
- `pi-reasoning` 0.2.18, published, 8 keywords.
- `pi-remote` 0.1.1, published, `dual-use`, ships `web/**` and `docs/**`, 12 keywords.
- `pi-sessions` 0.1.19, published, 6 keywords.
- `pi-statusline` 0.1.17, published, 7 keywords.
- `pi-web` 0.1.11, published, `dual-use`, ships `DISCLOSURE`, 10 keywords.

All ten declare `license: MIT`, `homepage`, `bugs.url`, `repository.directory`,
`engines.node >=22.19.0` and `pi.extensions: ["./index.ts"]`. The base `files`
array is `index.ts`, `lib/**`, `README.md`, `CHANGELOG.md`, `LICENSE`.

Declared scripts.

```console
pi-ask: test,test:coverage,release,release:dry
pi-cursor: test,test:coverage,typecheck,release,release:dry
pi-lyceum: test,test:coverage,typecheck,release,release:dry
pi-mcp: test,bench,test:watch,test:coverage
```

```console
pi-path-picker: test,release,release:dry,test:coverage
pi-reasoning: test,release,release:dry,test:coverage
pi-remote: test,test:coverage,typecheck,release,release:dry
pi-sessions: release,release:dry,test,test:coverage
```

```console
pi-statusline: release,release:dry,test,bench,test:coverage
pi-web: test,typecheck,release,release:dry,test:coverage
```

Four of ten packages declare `typecheck`. The root gates are `test`, `test:all`,
`lint` and `format:check`. None of them runs a `typecheck` script.

## 4. Registry state

```console
$ npm view @pixu1980/pi-statusline version
0.1.17
$ npm view @pixu1980/pi-mcp deprecated
Superseded by pi's built-in MCP support and the /mcp command.
```

```console
$ for p in ...; do npm view @pixu1980/$p version ; done
pi-ask 0.1.18   pi-cursor 0.1.5   pi-lyceum 0.1.0   pi-mcp 0.1.17
pi-path-picker 0.1.29   pi-reasoning 0.2.18   pi-remote 0.1.1
pi-sessions 0.1.19   pi-statusline 0.1.17   pi-web 0.1.11
```

Every published version equals the version in the working tree. No package
carries an unpublished change.

```console
$ npm view @pixu1980/<pkg> dist.attestations
false (all ten)
```

Publish dates, from `npm view <pkg> time.modified`.

```console
pi-remote 2026-11-27T11:07:46Z      pi-path-picker 2026-11-27T11:07:53Z
pi-web 2026-11-27T11:07:58Z         pi-cursor 2026-11-27T11:08:10Z
pi-lyceum 2026-11-27T11:08:18Z      pi-ask 2026-11-27T11:09:05Z
```

```console
pi-sessions 2026-11-27T11:09:14Z    pi-reasoning 2026-11-27T11:10:33Z
pi-mcp 2026-10-01T13:09:32Z         pi-statusline 2026-10-01T13:13:19Z
```

Nine packages published between 11:07 and 11:10 UTC today. The GitHub
`pushed_at` for the same range is `2026-11-27T11:06:39Z`. Each packument carries
license, homepage, bugs URL, repository directory and keywords. It does not
carry the `files` array.

Tarball contents, measured with `npm pack --dry-run`.

```console
$ cd packages/pi-remote && npm pack --dry-run
CHANGELOG.md 13.1kB   DISCLOSURE 3.0kB   LICENSE 1.1kB
README.md 5.3kB   docs/self-hosting-relay.md 4.3kB
index.ts   lib/*.ts (18 files)   lib/banner.svg
```

```console
$ cd packages/pi-lyceum && npm pack --dry-run
CHANGELOG.md 13.1kB   DISCLOSURE 3.4kB   LICENSE 1.1kB
README.md 7.0kB   index.ts 402B   lib/*.ts (5 files)
package size 19.2kB, total files 12
```

Clean-machine install, with an empty agent directory.

```console
$ PI_CODING_AGENT_DIR=/tmp/pi-clean-room/agent pi install npm:@pixu1980/pi-ask
added 1 package in 303ms
Installed npm:@pixu1980/pi-ask
```

```console
$ pi list
User packages:
  npm:@pixu1980/pi-ask
    /tmp/pi-clean-room/agent/npm/node_modules/@pixu1980/pi-ask
```

```console
$ node -p "require('.../pi-ask/package.json').version"
0.1.18
```

## 5. GitHub repository and community profile

State before this run changed it.

```console
$ gh api repos/... --jq '{description, homepage, topics, has_wiki}'
{"description":"Monorepo for Pi.dev extensions","homepage":null,
 "topics":[],"has_wiki":true}
```

State after the change, by decision recorded in the review:

```console
$ gh api repos/... --jq '{description, homepage, has_wiki, topics}'
{"description":"Nine pi coding agent extensions, published independently ...",
 "homepage":"https://pi.dev/packages","has_wiki":false,
 "topics":["ai-agent","coding-agent","extensions","llm","mcp","monorepo",
           "pi","pi-coding-agent","typescript"]}
```

`PATCH /repos/{owner}/{repo}` applied description, homepage and `has_wiki`. It
left `topics` empty. The dedicated `PUT /repos/{owner}/{repo}/topics` endpoint,
with body `{"names":[...]}`, applied the nine topics.

Settings this run did not change.

```console
$ gh api repos/... --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'
{"allow_merge_commit":false,"allow_squash_merge":false,"allow_rebase_merge":true}
```

```console
$ gh api repos/... --jq '.security_and_analysis | keys'
["dependabot_security_updates","secret_scanning","secret_scanning_non_provider_patterns",
 "secret_scanning_push_protection","secret_scanning_validity_checks"]
```

`dependabot_security_updates`, `secret_scanning` and
`secret_scanning_push_protection` are `enabled`. `web_commit_signoff_required`
is `false`.

```console
$ gh api repos/.../branches --jq '.[].name'
dependabot/npm_and_yarn/packages/pi-mcp/npm_and_yarn-8bbb79c431
main
```

```console
$ gh api repos/.../contents/.github/workflows
404 Not Found
$ curl -s -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/.../main/.github/dependabot.yml
404
```

```console
$ gh api repos/.../community/profile --jq '{health_percentage, files}'
health 100; issue_template: None; contributing, code_of_conduct, license,
readme, pull_request_template: present
```

```console
$ gh api repos/.../contents/.github/ISSUE_TEMPLATE --jq '.[].name'
bug_report.yml
feature_request.yml
```

The profile reports health 100 and `issue_template: None` at once. The contents
endpoint lists both form templates. The `None` is the profile field disagreeing
with the tree, not a missing file. Both templates reference the `bug` and
`enhancement` labels, and both labels exist.

```console
$ gh api repos/.../labels --jq '.[].name'
bug dependencies documentation duplicate enhancement good first issue
help wanted invalid javascript question
```

```console
$ gh api repos/.../private-vulnerability-reporting
{"enabled":true}
$ curl -s -o /dev/null -w "%{http_code}" https://raw.githubusercontent.com/.../main/SECURITY.md
200
```

Funding surface.

```console
$ cat .github/FUNDING.yml
github: pixu1980
$ curl -s -o /dev/null -w "%{http_code}" https://github.com/sponsors/pixu1980
200
```

```console
$ gh api graphql -f query='{user(login:"pixu1980"){hasSponsorsListing}}'
{"data":{"user":{"hasSponsorsListing":true}}}
$ gh api graphql -f query='{user(login:"pixu1980"){sponsorsListing{name isPublic tiers{totalCount}}}}'
{"name":"sponsors-pixu1980","isPublic":true,"tiers":{"totalCount":0}}
```

The listing is public and carries zero tiers. Counters: 7 stars, 1 fork, 1 open
issue-or-pull-request, `archived: false`, default branch `main`.

## 6. Contribution history

```console
$ gh api "repos/.../pulls?state=all&per_page=100" --jq length
2
$ gh api "repos/.../issues?state=all&per_page=100" --jq '[.[] | select(has("pull_request")|not)] | length'
1
```

| Item | State | Author | Created | Closed |
| ---- | ----- | ------ | ------- | ------ |
| Issue #1, branch rename | closed | fabian57fabian | 2026-06-28 | 2026-07-02. |
| PR #2, bump @vitest/mocker in pi-mcp | closed, unmerged | dependabot[bot] | - | 2026-09-16. |
| PR #3, npm_and_yarn group, pi-mcp | open | dependabot[bot] | 2026-09-17 | -. |

```console
$ gh api repos/.../pulls/3 --jq '{state, created_at, updated_at, mergeable_state}'
{"state":"open","created_at":"2026-09-17T13:26:51Z",
 "updated_at":"2026-11-27T11:06:10Z","mergeable_state":"clean"}
```

```console
$ gh api repos/.../pulls/3 --jq '{commits, changed_files, additions, deletions}'
{"commits":1,"changed_files":1,"additions":19,"deletions":29}
```

71 days open, mergeable and clean. The one file it touches is in
`packages/pi-mcp`, which `release.mjs` refuses to release. The history holds
zero merged pull requests.

## 7. Release path and tags

```console
$ git for-each-ref refs/tags --format='%(objecttype)' | sort | uniq -c
  75 commit
  65 tag
```

```console
$ git for-each-ref "refs/tags/@pixu1980/pi-statusline@*" --sort=-creatordate --format='%(objecttype) %(refname:short) %(creatordate:short)' | head -3
tag @pixu1980/pi-statusline@0.1.17 2026-10-01
tag @pixu1980/pi-statusline@0.1.16 2026-09-16
tag @pixu1980/pi-statusline@0.1.15 2026-09-16
```

The newest tag of every sampled package is an annotated tag object. 75 tags are
lightweight commit objects, dated 2026-08-07 and earlier in the sampled range.
`scripts/release.mjs` calls `commit-and-tag-version` without `--sign`. The
current path produces annotated, unsigned tags.

```console
$ gh api "repos/.../releases?per_page=100" --jq length
0
$ ls ROADMAP.md CHANGELOG.md
ls: CHANGELOG.md: No such file or directory
ls: ROADMAP.md: No such file or directory
```

`RELEASING.md` documents the procedure and the on-demand cadence. Each package
ships its own `CHANGELOG.md` in the tarball.

## 8. Gates and the suite

```console
$ GIT_CONFIG_GLOBAL=/dev/null pnpm test
# tests 42 | # pass 42 | # fail 0
```

```console
$ GIT_CONFIG_GLOBAL=/dev/null pnpm test:all
pi-ask 101 | pi-cursor 166 | pi-lyceum 47 | pi-mcp 42 | pi-path-picker 42
pi-reasoning 59 | pi-remote 63 | pi-sessions 34 | pi-statusline 80 | pi-web 28
result: 10 ok, 0 failed        (662 package tests, 42 root tests)
```

```console
$ pnpm lint
Checked 210 files. Found 1 info. ("biome.json schema 2.5.15 against the pinned 2.5.13")
$ pnpm format:check
All matched files use Prettier code style!
```

Without the `GIT_CONFIG_GLOBAL` override the same suite fails:

```console
$ pnpm test:all
✖ getGitStatus: clean repo reports branch + zero dirty
✖ git dirty repo counts modified files
✖ git cold cache serves fallback synchronously and backfills async
# tests 80 | # pass 72 | # fail 8
```

```console
commit-lint: rejected - "init" is not an accepted type
  at makeTempRepo (.../packages/pi-statusline/__tests__/_cache-stats.test.mjs:36:3)
```

```console
$ git config --get core.hooksPath
/Users/emilianopisu/.config/git/hooks
$ grep -rln "git commit" packages/*/__tests__ test/*.mjs
packages/pi-statusline/__tests__/_swr.test.mjs
packages/pi-statusline/__tests__/_unit.test.mjs
packages/pi-statusline/__tests__/_cache-stats.test.mjs
test/release-helpers.test.mjs
```

The eight failures are temp repositories passing `git commit` through the
machine's global `commit-msg` hook. That hook rejects the message `init`.

## 9. Tested host and typing

```console
$ pi --version
1.6.0
$ node -e '<print host devDependencies per manifest>'
pi-ask host=0.99.1 tui=0.99.1 peerHost=*
... identical for all ten manifests, except pi-lyceum with tui=none ...
$ grep -n "0.99" README.md
9:All nine extensions support the current pi, `0.99.x` and newer
```

`docs/adr/016-use-a-wildcard-peer-range-for-every-host-provided-pi-package-and-pin-the-host-in.md`
records 0.99.1 as the tested host. The installed host is 1.6.0.

The API surface the newest change uses exists in both pins:

```console
$ grep -c "session_info_changed" packages/pi-statusline/node_modules/.../types.d.ts
2
$ grep -c "session_info_changed" /opt/homebrew/Cellar/pi-coding-agent/1.6.0/.../types.d.ts
2
```

No gate compares the pinned host with the running host. No gate runs `tsc`.

## 10. Documents and governance inventory

Present at the root.

- `README.md` 3.9 kB.
- `CONTRIBUTING.md` 6.5 kB.
- `GOVERNANCE.md` 7.2 kB.
- `SECURITY.md` 6.5 kB.
- `CODE_OF_CONDUCT.md` 9.3 kB.
- `FUNDING.md` 2.8 kB.
- `RELEASING.md` 6.2 kB.
- `.mailmap` 675 B.

Present under `docs/` and `.github/`.

- `docs/adr`: 20 numbered files and a generated `ADR.md` index.
- `docs/audits`, `docs/reviews`, `docs/plans`: `oss.md` in each.
- `docs/handoff`: 6 files.
- `.github/FUNDING.yml`, `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/*.yml`.

Absent.

- `ROADMAP.md` and a root `CHANGELOG.md`.
- `.github/workflows` and `.github/dependabot.yml`.

`.gitignore` covers `.tokensave`, `node_modules/`, `*.log`, `.DS_Store`, `dist/`
and `.pi/`. `git ls-files | grep -c DS_Store` returns 0.

Governance statements read in full.

- One maintainer holds the final say.
- ADRs are immutable once accepted. A later ADR supersedes them.
- The merge gate is manual.
- Promotion criteria for a second maintainer are listed.
- The donor boundary is: a donor request that conflicts with the maintainer's
  judgment loses.
- No provenance and no CI are stated as accepted exposure, citing ADR 013.

`LICENSE` is MIT, copyright `Emiliano "pixu1980" Pisu`. `packages/pi-mcp/LICENSE`
keeps the upstream copyright `Nico Bailon`, as ADR 011 requires.

## 11. Code graph health (tokensave)

```console
$ tokensave_status
5892 nodes, 5736 edges, 313 files, db 147 MB, last_sync 2026-11-27
```

```console
$ tokensave_health
quality_signal 6281
acyclicity 0.9721 (15 edges in cycles) | depth 0.45 (max chain 20, ideal 9)
equality 0.3109 (gini 0.6891) | redundancy 0.7248 (dead 779 / 2831 fns)
modularity 0.9918 (122 components) | coverage_discipline 1.0
```

```console
$ tokensave_dsm
313 files, 538 edges, density 0.0055, 42 clusters, largest 51
$ tokensave_gini (complexity, files)
0.7831 over 276 files; top outlier packages/pi-mcp/lib/_app-bridge.bundle.js
```

```console
$ tokensave_coupling (fan_in)
packages/pi-mcp/lib/_types.ts 27 | test/harness.mjs 20
packages/pi-mcp/lib/_utils.ts 20
```

```console
$ tokensave_circular
6 cycles: pi-remote (_ask/_chat), pi-remote web (app/relay)
pi-mcp (_mcp-output-guard/_mcp-trace/_types/_ui-stream-types)
pi-mcp (_server-manager/_unix-socket-transport), pi-mcp (_mcp-status/_state)
scripts (release-helpers/release.mjs)
```

```console
$ tokensave_dependency_depth
max 20, ideal 9; longest chain starts in packages/pi-mcp/__tests__
and ends in packages/pi-remote/lib/_pairing.ts
```

Caveat measured from the same output. `packages/pi-mcp/lib/_app-bridge.bundle.js`
is generated and tracked (676 kB, ADR 014). It holds the top gini outlier, two
of the top test-risk entries and part of the depth chain. The quality signal
covers built code as well as hand-written code.

## 12. Sources consulted

- OpenSSF Scorecard checks, `docs/checks.md` at `main`, 46550 bytes read.
- Checks read: Binary-Artifacts, Branch-Protection, CI-Tests, Code-Review,
  Contributors, Dangerous-Workflow, Dependency-Update-Tool, Fuzzing, License,
  Maintained, Packaging, Pinned-Dependencies, SAST, SBOM, Security-Policy,
  Signed-Releases, Token-Permissions, Vulnerabilities, Webhooks.
- Open Source Guides, "Best Practices for Maintainers", 18578 bytes read.
- Headings read: "Documenting your processes", "Communicate your expectations",
  "Keep communication public", "Leverage your community".
- Headings read: "Require tests and other checks", "Use tools to automate basic
  maintenance tasks".
- GitHub REST and GraphQL endpoints cited in §5, §6 and §7.

## 13. Out of scope observations

- On the audit machine the npm `@pixu1980/pi-statusline` was removed and the
  local `packages/pi-statusline` installed into `.pi/settings.json`. That tested
  an unreleased change. It is a machine setting, not repository state, and
  `.pi/` is git-ignored.
