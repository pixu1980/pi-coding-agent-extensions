# Execution Plan - pi-mcp: slash commands without server prefix (bare names)

Goal (user request): MCP commands in pi (`/mcp__pix_galaxy_mcp__pix-code-review`)
become `/pix-code-review` and each tool becomes a command with its name, e.g. `/pix-frontend-vanilla-reactive`,
`/pix-frontend`, `/pix-data-indexed-db` (no server prefix, hyphens instead of underscores).

Where the naming comes from: package `@pixu1980/pi-mcp` (fork of pi-mcp-adapter), `packages/pi-mcp/lib/_types.ts`:
- tool → `formatToolName()` (line 561), `ToolPrefix` mode already configurable (`server|short|none|mcp`)
- prompt → `formatPromptCommandName()` (line 584) with HARDCODED prefix `mcp__${server}__`

Status: `toolPrefix: "none"` exists but (a) tools still use underscores, (b) prompts ignore the mode.

---

## Phase 1 - Failing tests (TDD)

- [ ] 1. In `__tests__/_unit.test.mjs`: tests that currently fail
  - a) `formatToolName("pix_frontend_vanilla_reactive", "pix-galaxy-mcp", "none")` → `pix-frontend-vanilla-reactive` (today: `pix_frontend_vanilla_reactive`)
  - b) `formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "none")` → `pix-code-review` (today: `mcp__pix_galaxy_mcp__pix-code-review`)
  - c) Regressions: other modes unchanged (`server`, `short`, `mcp`, default prompt)

## Phase 2 - Implementation (`lib/_types.ts`)

- [ ] 2. `formatToolName`: with prefix `"none"` → bare name with `_`→`-` (1 line)
- [ ] 3. `formatPromptCommandName`: with prefix `"none"` → bare `sanitizePromptName`; other modes unchanged

## Phase 3 - User config

- [ ] 4. `~/.pi/agent/mcp.json`: `"toolPrefix": "none"` for the `pix-galaxy-mcp` server (per-server, no impact on tokensave/mdn)
- [ ] 5. Collision check: `pix` (router), `pix-update`, prompt `pix-code-review` vs tool `pix-process-code-review` → distinct names

## Phase 4 - Docs + release

- [ ] 6. Package README: document the `"none"` behavior (dash-separated tools, bare prompts)
- [ ] 7. Bump version 0.1.5 → 0.1.6 + tag (repo release script) + publish npm
- [ ] 8. Pi updates the package on restart (list `packages` in `~/.pi/agent/settings.json`)
