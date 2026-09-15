# Execution Plan - pi-mcp: slash commands without server prefix (bare names)

Goal (user request): MCP commands in pi (`/mcp__pix_galaxy_mcp__pix-code-review`)
become `/pix-code-review` and each tool becomes a command with its name
(no server prefix, hyphens instead of underscores).

Where the naming comes from: package `@pixu1980/pi-mcp` (fork of pi-mcp-adapter), `packages/pi-mcp/lib/_types.ts`.

**Status: closed 2026-09-15.** Every item below is either implemented and committed, or superseded.
Re-analysis found nothing left to implement; the only item that had never been executed was the
collision check, which this run performed against the live metadata cache.

## Phase 1 - Failing tests (TDD)

- [x] 1. In `__tests__/_unit.test.mjs`: tests that currently fail
  - a) `formatToolName("pix_frontend_vanilla_reactive", "pix-galaxy-mcp", "none")` → `pix-frontend-vanilla-reactive`
  - b) `formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "none")` → `pix-code-review`
  - c) Regressions: other modes unchanged (`server`, `short`, `mcp`, default prompt)

  > Written and committed in `91c4db6 feat(pi-mcp): bare dash-separated slash commands with toolPrefix none`.
  > Live at `__tests__/_unit.test.mjs:320` (tools), `:327` (prompts), `:332` (regressions for every other mode).

## Phase 2 - Implementation (`lib/_types.ts`)

- [x] 2. `formatToolName`: with prefix `"none"` → bare name with `_`→`-`
- [x] 3. `formatPromptCommandName`: with prefix `"none"` → bare `sanitizePromptName`; other modes unchanged

  > `_types.ts:570` (`if (!p) return sanitized.replace(/_/g, "-")`) and `_types.ts:599` (`if (!serverPart) return sanitized`),
  > both committed in `91c4db6`. `resolveToolPrefix` resolves per-server over global and defaults to `"server"`.

## Phase 3 - User config

- [x] 4. `~/.pi/agent/mcp.json`: `"toolPrefix": "none"` for the `pix-galaxy-mcp` server (per-server, no impact on tokensave/mdn)
- [x] 5. Collision check: `pix` (router), `pix-update`, prompt `pix-code-review` vs tool `pix-process-code-review` → distinct names

  > 4. Present at `~/.pi/agent/mcp.json:27`; the other three servers keep the default `server` prefix.
  >
  > 5. Executed this run against `~/.pi/agent/mcp-cache.json` (the real discovered surface) plus the user config:
  > resolved prefix per server (`tokensave=server 84 tools`, `pix-galaxy-mcp=none 107 tools + 151 prompts`,
  > `mdn=server 3`, `ms-learn=server 3`), then rendered every name through `formatToolName` /
  > `formatPromptCommandName` and grouped by bare name. Result: **348 bare names, 0 collisions, no duplicates**.
  > The plan's example names were from an older revision of the server: what exists today is `/pix-tool`,
  > `/pix-tool-update`, `/pix-adr`, `/pix-area-ai`, `/pix-update` (prompt) — all distinct.

## Phase 4 - Docs + release

- [x] 6. Package README: document the `"none"` behavior (dash-separated tools, bare prompts)
- [x] 7. Bump version 0.1.5 → 0.1.6 + tag (repo release script) + publish npm
- [x] 8. Pi updates the package on restart (list `packages` in `~/.pi/agent/settings.json`)

  > 6. Documented in `README.md:199` (per-server) and `README.md:280` (global default table).
  >
  > 7. Superseded: the package is at **0.1.13** and 0.1.13 is published on npm, i.e. the 0.1.6 target
  > this plan named was passed long ago by the normal release flow.
  >
  > 8. Obsolete as written: `~/.pi/agent/settings.json` has `packages: []` by design - pi resolves these
  > extensions per project through `.pi/settings.json` (which lists `../packages/<pkg>`), so a restart
  > always picks up the local source. Nothing to add there.
