# Handoff 03 — performance run close and roadmap reconciliation

- **Branch**: `main` (no branch created; commits local, not pushed)
- **Commit range covered**: `dc16945..bb05c75`
  - `c66dfc0` feat(pi-reasoning): share the /effort menu and derive level labels from one rule
  - `763ef16` fix(pi-statusline): match pi-reasoning's effort emoji and measure width by grapheme
  - `2632437` perf(pi-cursor): memoize the model catalog and make discovery single-flight
  - `f519acf` perf(pi-sessions): serve the session listing cache without filesystem calls
  - `c0ea384` feat(pi-path-picker): publish the autocomplete provider over the event bus
  - `5cb4da2` perf(pi-mcp): print the machine context in the startup bench
  - `98b2264` feat(pi-ask): complete paths in the ask and interview editors
  - `a52f78f` test(harness): mirror pi's EventBus on/emit contract in the mock
  - `bb05c75` docs(adr): record the pi-sessions cache decision and close the performance run
- **Date**: 2026-09-15
- **Working tree**: clean at handoff time

---

## HANDOFF: pi-coding-agent-extensions

### Project Identity

- Description: Monorepo for pi.dev extensions, themes, and packages
- Version: 0.0.0

### What this session did

1. **Executed the last three steps of the performance plan** (PERF-09, PERF-10, PERF-11),
   then closed the plan: it is deleted because nothing is open.
2. **Re-analyzed the two remaining roadmaps** instead of implementing blindly:
   `execution-plan-pi-mcp.md` turned out to be already done or superseded (only its collision
   check had never run — executed, 348 bare names, 0 collisions); `execution-plan.md`'s release
   item shipped as pi-ask 0.1.12.
3. **Committed everything atomically, one commit per package**, plus a separate final commit for
   the decision documents. Nothing pushed.

### ADR Log

| # | Status | Title | Tags |
|---|--------|-------|------|
| 008 | accepted | Make the pi-sessions listing cache filesystem-free with explicit invalidation | performance, caching, pi-sessions |
| 007 | accepted | Lazy startup graph verified by bench in pi-mcp | architecture, performance, pi-mcp |
| 006 | accepted | Bounded concurrent reconnect and coalesced panel renders | architecture, performance, pi-mcp |
| 005 | accepted | Cache counters and explicit invalidation contracts | architecture, performance, caching |
| 004 | accepted | Bounded session discovery in pi-sessions | architecture, performance, pi-sessions |
| 003 | accepted | Read-through metadata cache for pi-mcp | architecture, performance, pi-mcp |
| 002 | accepted | Async secret command resolution in pi-mcp | architecture, performance, pi-mcp |
| 001 | accepted | Stale-while-revalidate for statusline render-path caches | architecture, performance, pi-statusline |

### The measurements that drove the decisions

| Path | Cost | Consequence |
|---|---|---|
| pi-sessions cold listing (493 sessions, 133,922 lines) | **4341.9 ms** | the cache is load-bearing |
| pi-sessions cached serve | **0.012 ms** | cached path now makes zero filesystem calls |
| one directory `statSync` | **1.80 us** | 0.00004% of the listing it guarded; dropped |
| render bench, 200 cached frames | p99 **0.012 ms**, 0 background refreshes | load-invariant gate |
| pi-mcp startup barrel | 1361.5 ms, `_mcp-panel` 868.3 ms cold | panels confirmed lazy |

Two findings came out of the measurements rather than the plan:

- The pi-sessions mtime check statted the **parent** `sessions/` dir, which does not change when a
  session is written into an existing project subdirectory — it paid a syscall per panel open for
  an invalidation it never delivered. Freshness is now explicit (`clearSessionsCache()` on
  `session_start`), deliberately **not** on `turn_end`, which would make panel opens pay 4.3 s.
- `pi-cursor`'s `fetchModels` forced a refresh on **every** call, bypassing its own 6-hour cache.

### Verifications run

| Suite | Result |
|---|---|
| pi-cursor | 153/153 |
| pi-ask | 101/101 |
| pi-reasoning | 59/59 |
| pi-statusline | 60/60 |
| pi-sessions | 34/34 |
| pi-path-picker | 42/42 (run via `node --import tsx --test`, see gotcha below) |
| pi-statusline bench | invariant gates pass; both wall-gate arms proven (breach 26.6 ms → exit 1) |
| pi-mcp startup bench | all gates pass under loadavg 113 |

### Known gotchas

- `pnpm test` inside a package can fail on pnpm's dependency pre-check
  (`ERR_PNPM_IGNORED_BUILDS`) before any test runs. Workaround used: run the script body directly,
  e.g. `node --import tsx --test __tests__/index.test.mjs`.
- The machine has been at loadavg 89-118 on 10 cores for the whole session, so wall-clock numbers
  are load-bound. The render bench therefore prints loadavg/cores/spawn-baseline and takes
  `PI_BENCH_QUIET=1|0` to force either arm of the wall-time gate.

### Open items

- **Release is pending a user decision, not a mechanical step.** The working tree is clean, but the
  9 commits are unpushed and unreleased. `scripts/release.mjs` bumps **every** package with changes
  since its last tag, so a release now would sweep pi-reasoning, pi-statusline, pi-cursor,
  pi-sessions, pi-mcp, pi-path-picker and pi-ask into one release. The user explicitly chose not to
  release in this session.
- `docs/plans/execution-plan-pi-mcp.md` — closed, all items `[x]` with evidence. Could be deleted if
  a completed plan file is not wanted.
- `docs/plans/execution-plan.md` — item 15 marked done for its planned scope, with a note that the
  newer pi-ask path-completion work is unreleased and awaits that release decision.
- `packages/pi-*`/pnpm-lock.yaml files were realigned to the exact versions in `package.json` by an
  earlier install; that change rode along in its own package's commit.

### Instructions for the next session

- Read the ADRs before touching the perf-related code paths; each states what its decision costs and
  what observation would end it.
- Before optimizing anything in pi-sessions, re-read ADR 008: the cache is what makes the panel
  usable, and any invalidation strategy that clears it often makes opens pay seconds.
- If the user asks for a release, confirm the scope first (all changed packages vs a subset).

---

## Commit-scope convention (reminder)

`type(scope): subject`, Conventional Commits, scope never optional — the `commit-msg` hook rejects a
scope-less message. Scope is the package or area: `pi-statusline`, `pi-sessions`, `pi-mcp`,
`pi-reasoning`, `pi-cursor`, `pi-ask`, `pi-path-picker`, `harness`, `adr`, `handoff`, `docs`.

One commit per package; decision documents (ADR, CHANGELOG, docs/) in one separate final commit.

**Handoff file**: `docs/handoff/03-performance-run-and-roadmap-close.md`
