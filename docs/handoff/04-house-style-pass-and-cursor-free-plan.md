# Handoff 04 — house style pass, pi-cursor Free plan, and the document cleanup

- **Branch**: `main` (no branch created; every commit is local, nothing pushed)
- **Commit range covered**: `10e5747..9244baf` (15 commits)
- **Date**: 2026-09-15
- **Working tree**: clean at handoff time

---

## HANDOFF: pi-coding-agent-extensions

### Project Identity

- Description: Monorepo for pi.dev extensions, themes, and packages
- Version: 0.0.0
- Packages (8): pi-ask, pi-cursor, pi-mcp, pi-path-picker, pi-reasoning,
  pi-sessions, pi-statusline, pi-web

### What this session added

1. **pi-cursor works on a Free Cursor plan.** Cursor's Cloud catalog endpoint
   answers `403 [plan_required]` on a Free plan, and `@cursor/sdk` validates a
   local model selection through that same endpoint, so every run failed before
   it started. Fixed by reporting the real error, listing Auto (model id
   `default`) in the fallback catalog, and publishing the resolved catalog to
   `CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON` so validation happens in process.
2. **A repo-wide style pass**, mechanical plus prose, driven by ESLint and the
   pix prose transformer. Guardrail violations went from roughly 4017 to 279.
3. **Repo hardening that survived**: pi-cursor declared dual-use, root package
   private, banners reformatted, ADR 009 written.
4. **Removals requested by the user**: `.github/`, `.devcontainer/`, and the
   whole backlog/plan/audit/review/security document set.

### Decisions, and the reason for each

1. **The official pix fixer was rejected.** `scripts/fix/self-guardrails` from
   pix-galaxy-mcp inserts blank lines inside parameter lists and array literals
   when run on TypeScript. The pass used ESLint 10 with typescript-eslint,
   `@stylistic`, and `eslint-plugin-unicorn`, mapping each pix guardrail to its
   ESLint equivalent (`curly`, `padding-line-between-statements`,
   `padded-blocks`, `lines-between-class-members`, `@stylistic/brace-style`,
   `@stylistic/indent`, `unicorn/*`). The tooling lives in `/tmp`, no dependency
   was added to the repo.
2. **Prose was split by intent.** `stripFingerprint` from pix-galaxy-mcp did the
   British-to-American and typographic work. Where a glyph is deliberate
   terminal interface (pi-statusline's `-`, `...`, arrows; pi-reasoning's ZWJ
   emoji), the run used `spellingOnly`, which keeps the characters and applies
   only the spelling rules. Full transforms there broke real tests.
3. **`cancelled` is not always a spelling mistake.** pi-cursor compares against
   the Cursor SDK's `RunStatus`, whose value is `"cancelled"`. Those two
   occurrences were restored by hand and are the one remaining
   `fp-american-english` violation. Internal fields elsewhere were renamed to
   `canceled`, tests included.
4. **The banners are SVGO output.** The user's formatting is
   `svgo preset-default` with `cleanupIds: false`: the preset drops
   `role="img"` and unused filters, normalizes attribute order and escapes `>`,
   and the id override keeps the ids `aria-labelledby` points at. The banner test
   now pins the accessible name through `aria-labelledby` plus the title and
   description ids instead of `role="img"`.
5. **Two removals were verified before acting.** `backup/pre-rewrite` is local
   only (`git ls-remote --heads origin` does not know it) and its workflows were
   identical to `main`, so the stale-branch vector did not apply and the branch
   was left alone. `.devcontainer/` and `.github/` were deleted on request;
   `.github` held only the two workflows, and the test that asserted a publishing
   workflow does not exist was removed with them.

### Verified facts about this environment

- **The 3-day dependency cooldown was never active.** `minimumReleaseAge=4320`
  in `.npmrc` is ignored by pnpm 11; the key is read only from
  `pnpm-workspace.yaml`. Measured with `zod@4.6.5`, published two days earlier:
  `.npmrc` (either `minimumReleaseAge` or `minimum-release-age`) installs it,
  `pnpm-workspace.yaml` refuses it with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`.
  Not activated, because `packages/pi-cursor/pnpm-lock.yaml` pins that version
  and `pnpm install` and `pnpm test` would fail there until 2026-09-16T23:25Z or
  a lockfile rebuild.
- **`packages/pi-web/pnpm-lock.yaml` is out of sync with its manifest** (for
  example `linkedom`: lockfile `^0.16.11`, manifest `0.18.13`), so
  `pnpm install --frozen-lockfile` fails in pi-web. Pre-existing.
- **`allowBuilds` placeholders** stay unresolved in pi-ask, pi-path-picker and
  pi-web (`set this to true or false`); pi-cursor declares `false`.

### ADR Log

| # | Status | Title | Tags |
| --- | --- | --- | --- |
| 009 | accepted | Publish the local Cursor model catalog to the SDK instead of relying on the Cloud catalog | pi-cursor, cursor-sdk, models, environment-variables |
| 008 | accepted | Make the pi-sessions listing cache filesystem-free with explicit invalidation | performance, caching, pi-sessions, invalidation |
| 007 | accepted | Lazy startup graph verified by bench in pi-mcp | architecture, performance, pi-mcp, startup |
| 006 | accepted | Bounded concurrent reconnect and coalesced panel renders | architecture, performance, pi-mcp, backpressure |
| 005 | accepted | Cache counters and explicit invalidation contracts | architecture, performance, caching, observability |
| 004 | accepted | Bounded session discovery in pi-sessions | architecture, performance, pi-sessions |
| 003 | accepted | Read-through metadata cache for pi-mcp | architecture, performance, pi-mcp, caching |
| 002 | accepted | Async secret command resolution in pi-mcp | architecture, performance, pi-mcp |
| 001 | accepted | Stale-while-revalidate for statusline render-path caches | architecture, performance, pi-statusline |

### Documentation Status

- `docs/adr/001..009` plus `docs/adr/ADR.md` (regenerated).
- `docs/handoff/01..04`.
- Everything else under `docs/` is gone: `docs/plans/`, `docs/audits/`,
  `docs/reviews/`, `docs/compliance-study-2026.md`, `docs/security.md`, and the
  two `docs/prompt-conformita-release-2026*.md` files. The handoffs 01 to 03
  still name those paths; they are historical records and were left untouched.

### Recent Commits

```
9244baf docs(docs): remove the finished plans, audits and studies
e805797 docs(adr): record the local Cursor catalog decision
e52fe29 chore(ci): remove the GitHub Actions workflows
eb00a0e chore(banner): reformat the SVG banners with SVGO and relax the banner test
2fdf1ad chore(repo): mark the root package private
71ff134 style(pi-statusline): normalize the package to the house style
6b03aa8 style(pi-web): normalize the package to the house style
6419093 style(pi-sessions): normalize the package to the house style
0222133 style(pi-reasoning): normalize the package to the house style
9e42e95 style(pi-path-picker): normalize the package to the house style
567cbfd style(pi-mcp): normalize the package to the house style
f3009c3 style(pi-ask): normalize the package to the house style
026e2b4 test(pi-statusline): cover the render bench quiet decision
8b11a46 chore(pi-cursor): declare the package dual-use
2202763 feat(pi-cursor): keep local agents working on a Free Cursor plan
```

### Verification actually run

```bash
# every package, after the style pass and after every later edit
node --import tsx --test __tests__/index.test.mjs   # in each of the 8 packages
#   pi-ask 101, pi-cursor 166, pi-mcp 42, pi-path-picker 42,
#   pi-reasoning 59, pi-sessions 34, pi-statusline 65, pi-web 28  => 537 pass, 0 fail

pnpm test                                          # repo root: 13 pass, 0 fail

# a whole-monorepo tsc run (TS 7.0.2) comparing the error multiset before and
# after the style pass: identical, 20 pre-existing errors, all in pi-mcp

pnpm typecheck                                     # packages/pi-cursor: clean

node /tmp/pixkit2/src/.../checkCode                # guardrail inventory per file
#   start ~4017 failing rules, end 279

node scripts/release.mjs --dry-run                 # 8 packages, pi-cursor DISCLOSURE validated
zizmor .github/workflows                           # clean, before the workflows were removed

# live wiring, pi-cursor
pi -ne -ns -np -nt --offline -e ./packages/pi-cursor --list-models cursor
#   composer-2@128k, composer-2@200k, default, grok-4.6
pi -ne -ns -np -nt --no-session -e ./packages/pi-cursor --provider cursor --model cursor/default -p "Reply with exactly: OK"
#   plan_required note, then OK
```

### Open work

- **Nothing is pushed.** All 15 commits are local for review.
- **Release security, unrecorded anywhere else now.** The deleted
  `docs/security.md` held a manual checklist that was never executed. It needs
  re-creating or executing: GitHub tag ruleset "Tags only by admins"; GitHub
  Immutable Releases; 2FA required on the account; npm "Require 2FA or
  automation tokens" on all 8 packages; personal 2FA (hardware key). Then
  `npm whoami` and `node scripts/release.mjs --dry-run`.
- **The release model is undecided.** Local releases with a token on the laptop
  (current, `docs/security.md` argued for it) versus Trusted plus Staged
  Publishing in a workflow with `id-token: write`, staged approval and a
  provenance badge. No workflow exists now that `.github/` is gone.
- **The dependency cooldown still needs activating**, in every
  `pnpm-workspace.yaml`, together with the lockfile rebuild that makes
  `packages/pi-cursor` install again (see Verified facts).
- **pi-cursor dual-use status** is declared, and `docs/security.md`, which listed
  the packages, is gone; if that table comes back it has to list 8.
- **Remaining style debt, deliberately not touched**: `jsdoc-required` (217
  symbols, needs authored descriptions), the pi-mcp embedded UI CSS rules
  (`no-css-classes` 15, `external-css` 3, `css-comments-required` 3, a data-part
  refactor), pi-statusline's deliberate glyphs (25 + 6), two single-assertion
  boundaries in pi-mcp, `a11y-test-required` on `.test.cjs` files of CLI packages
  (false positive), and the 295 KB vendored `_app-bridge.bundle.js` that trips the
  check's size cap.
- **`packages/pi-cursor/README.md` no longer links a deletion**, but the phrase
  "What the reduction dropped" carries the substance the audit used to hold.
- **A pre-push review is untested**: no workflow exists to run the suite in CI
  anymore, so `.github/` removal means tests run only locally.

### Handoff Instruction

Continue on **pi-coding-agent-extensions**. The working tree is clean and the
last 15 commits are local. Start from the open work above: the release security
checklist is the only item with a hard deadline attached to publishing, and the
cooldown activation is the only one that can break an install if done alone.
Before adding CI back, decide the release model, because a `publish.yaml`
without Trusted Publishing configured on npm is worse than none.

### Commit scope convention (reminder)

Every commit in this repo uses Conventional Commits **with a mandatory scope**:

```
type(scope): subject
```

Observed scopes: a package name (`pi-cursor`, `pi-mcp`), or an area (`repo`,
`banner`, `ci`, `adr`, `docs`, `handoff`, `workflows`). `audit`, `perf`,
`release` and `handoff` are areas, not packages. Never push from the agent.
