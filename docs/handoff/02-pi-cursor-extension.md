# Handoff 02 — pi-cursor extension

- **Branch**: `main` (no branch created; commits local, not pushed)
- **Commit range covered**: `bbe7ef9..c880849`
  - `74e9d5e` feat(pi-cursor): add Cursor API key provider extension
  - `c880849` docs(audit): add pi-cursor-sdk source and egress audit
- **Date**: 2026-09-15
- **Working tree**: clean at handoff time

---

## HANDOFF: pi-coding-agent-extensions

### Project Identity

- Description: Monorepo for pi.dev extensions, themes, and packages
- Version: 0.0.0

### What this session added

New package `packages/pi-cursor` — `@pixu1980/pi-cursor@0.1.0`, a reduced
re-implementation of `fitchmultz/pi-cursor-sdk` that keeps only "use my Cursor
API key in pi".

Layout (9 lib modules, 10 test files):

| File | Role |
| --- | --- |
| `lib/_types.ts` | Egress allowlist, provider identity, sentinel, fallbacks |
| `lib/_api-key.ts` | Key resolution (pi auth.json → `CURSOR_API_KEY`), no writes |
| `lib/_egress.ts` | Allowlist predicates, backend-override refusal, surface report |
| `lib/_scrub.ts` | Key/credential scrubbing for every emitted string |
| `lib/_cache.ts` | Model catalog cache, mode 0600, no key material |
| `lib/_models.ts` | Catalog → pi models, thinking map, selection builder |
| `lib/_session.ts` | One Cursor agent per pi session, disposal |
| `lib/_stream.ts` | Cursor deltas → pi AssistantMessageEventStream |
| `lib/index.ts` | Factory: provider, `/cursor-*` commands, shutdown hook |

Upstream audited at `a8fecf1` (v0.3.6); full evidence in
`docs/audits/pi-cursor-sdk-source-audit.md`.

### Decisions and the reason for each

1. **Local agents only.** Cloud agents dropped: they upload the repo to Cursor.
2. **No MCP/tool bridge.** Upstream runs a loopback HTTP server exposing pi's
   `read`/`bash`/`write`/`edit`/`grep`/`find`/`ls` to the Cursor agent. Dropped —
   the Cursor agent has its own tools. Consequence documented in the README:
   pi's tool approval layer does **not** intercept the Cursor agent's own tool
   calls.
3. **Tool activity is display-only.** Streamed as a bounded thinking trace, never
   as `toolCall` blocks: pi would execute those a second time.
4. **No key fingerprint in the cache.** Upstream stored `sha256(apiKey)` in a
   readable cache file — an offline key-verification oracle.
5. **`CURSOR_BACKEND_URL` refused** unless it resolves inside the allowlist; the
   auth `resolve()` returns `undefined` so the failure is fail-closed.
6. **No HTTP client in the package.** Source-level test fails the build on
   `fetch`/`http.request`/`net.connect`/`WebSocket`/`child_process` or any URL
   literal outside `api.cursor.com` / `api2.cursor.sh`.
7. **Placeholder before `/login`.** `resolve()` hands pi a non-secret sentinel so
   Cursor models stay visible in the picker; `streamCursor` normalises it to
   `undefined` and errors before any request.

### Verified facts about `@cursor/sdk@1.0.27`

- Bundles `@statsig/js-client@3.31.0`, but constructs it with
  `preventAllNetworkTraffic: true`, `disableLogging: true`, `disableStorage: true`
  and feeds it from Cursor's own `BootstrapStatsig` RPC. The `statsigapi.net` /
  `featureassets.org` / `api.statsigcdn.com` / `prodregistryv2.org` endpoints are
  compiled in but unreachable in this configuration.
- Emits `sdk.*` run counters to `api2.cursor.sh`
  (`aiserver.v1.AnalyticsService.TrackEvents`). Cursor-owned, no user content,
  API key only as bearer. **No client-side switch to disable it.**
- `sdk.request.pr_opened` probes local git/PR providers and reports PR
  identifiers. Cursor-bound, but unprompted.

### ADR Log

| # | Status | Title | Tags |
| --- | --- | --- | --- |
| 007 | accepted | Lazy startup graph verified by bench in pi-mcp | architecture, performance, pi-mcp |
| 006 | accepted | Bounded concurrent reconnect and coalesced panel renders | architecture, performance, pi-mcp |
| 005 | accepted | Cache counters and explicit invalidation contracts | architecture, performance, caching |
| 004 | accepted | Bounded session discovery in pi-sessions | architecture, performance, pi-sessions |
| 003 | accepted | Read-through metadata cache for pi-mcp | architecture, performance, pi-mcp |
| 002 | accepted | Async secret command resolution in pi-mcp | architecture, performance, pi-mcp |
| 001 | accepted | Stale-while-revalidate for statusline render-path caches | architecture, performance, pi-statusline |

No ADR was written for pi-cursor. Candidates if work resumes: (a) no HTTP client
+ allowlist guard, (b) placeholder-until-login auth, (c) display-only tool trace.

### Documentation Status

- `docs/audits/pi-cursor-sdk-source-audit.md` (10 KB, 2026-09-15) — this session
- `docs/adr/001..007` + `docs/adr/ADR.md` (2026-09-15)
- `docs/plans/execution-plan.md` (2026-08-25), `docs/plans/execution-plan-pi-mcp.md` (2026-08-07)
- `docs/plans/performance.md` (2026-09-15), `docs/handoff/01-performance-optimization-execution.md`

### Recent Commits

```
c880849 docs(audit): add pi-cursor-sdk source and egress audit
74e9d5e feat(pi-cursor): add Cursor API key provider extension
bbe7ef9 chore(release): 0.1.12
2ffbfd1 chore(release): 0.1.13
73e4b79 chore(release): 0.1.13
9ca3fbd chore(handoff): add session handoff 01-performance-optimization-execution
afb2cb9 docs(performance): plan execution records and ADR 001-007
ab7b2bf perf(pi-mcp): add startup graph bench gating lazy panels
2b04c3b perf(pi-sessions): bound session discovery with top-k and scan caps
049207e perf(pi-mcp): bounded concurrent reconnect and coalesced panel renders
3d60c53 perf(pi-mcp): async secret commands and read-through caches
8b0ada6 perf(pi-statusline): stale-while-revalidate render caches with hit-rate debug
```

### Verification actually run

```bash
cd packages/pi-cursor
pnpm test        # 143 tests, 143 pass, 0 fail
pnpm typecheck   # tsc --noEmit, clean

# real pi wiring
pi -ne -ns -np -nt --offline -e ./packages/pi-cursor --list-models cursor
#   cursor  composer-2@128k / composer-2@200k / grok-4.6

# stream path with a fake key (one request to api2.cursor.sh)
CURSOR_API_KEY=crsr_fake... pi -ne -ns -np -nt --no-session -e ./packages/pi-cursor \
  --provider cursor --model cursor/grok-4.6 -p "say hi"
#   pi-cursor: Cursor model discovery failed (AuthenticationError); ...
#   Invalid User API Key
```

`pnpm test` needs `packages/pi-cursor/pnpm-workspace.yaml` to declare
`allowBuilds` for `@google/genai`, `esbuild`, `protobufjs` (all `false`).
Without it pnpm's ignored-builds check fails the run.

### Open work

- [ ] **Not run**: `pix_tool_check` guardrails. The worker times out on every
      input, including `const x = 1;`, across `pix-styleguide-baseline`,
      `pix-styleguide-typescript` and the gateway. Tool-side fault, not code.
      Re-run once the worker is healthy.
- [ ] **Not published**: version `0.1.0`, no `pi install` from npm, no local
      `pi install -l` in `.pi/settings.json`.
- [ ] **Not verified live**: the whole stream path with a real Cursor API key.
      Unit tests use an injected fake SDK; discovery failing on a fake key is the
      only live request made.
- [ ] Optional: adopt in this repo — `pi install -l npm:@pixu1980/pi-cursor`
      would add it to `.pi/settings.json` (note `.pi/` is gitignored).
- [ ] Optional: ADR for the three decisions listed above.

### Handoff Instruction

Continue on **pi-coding-agent-extensions**. `packages/pi-cursor` is committed and
green. Do not re-audit upstream — read
`docs/audits/pi-cursor-sdk-source-audit.md` first. Next natural steps are the
open-work items above; publishing needs `pnpm release` from the package.

### Commit scope convention (reminder)

Every commit in this repo uses Conventional Commits **with a mandatory scope**:

```
type(scope): subject
```

Observed scopes: `pi-cursor`, `audit`, `perf`/`release`/`handoff` are not scopes —
use the package or area, e.g. `feat(pi-cursor): ...`, `docs(audit): ...`,
`perf(pi-mcp): ...`, `chore(release): ...`, `chore(handoff): ...`.
