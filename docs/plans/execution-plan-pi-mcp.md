# Execution Plan — pi-mcp: comandi slash senza prefisso server (nomi nudi)

Obiettivo (richiesta utente): i comandi MCP visti in pi (`/mcp__pix_galaxy_mcp__pix-code-review`)
diventano `/pix-code-review` e ogni tool diventa un comando col suo nome, es. `/pix-frontend-vanilla-reactive`,
`/pix-frontend`, `/pix-data-indexed-db` (niente prefisso server, trattini al posto degli underscore).

Dove nasce il naming: package `@pixu1980/pi-mcp` (fork di pi-mcp-adapter), `packages/pi-mcp/lib/_types.ts`:
- tool → `formatToolName()` (riga 561), modalità `ToolPrefix` già configurabile (`server|short|none|mcp`)
- prompt → `formatPromptCommandName()` (riga 584) con prefisso `mcp__${server}__` HARDCODED

Stato: `toolPrefix: "none"` esiste ma (a) i tool restano con underscore, (b) i prompt ignorano la modalità.

---

## Phase 1 — Test fallenti (TDD)

- [ ] 1. In `__tests__/_unit.test.mjs`: test che falliscono oggi
  - a) `formatToolName("pix_frontend_vanilla_reactive", "pix-galaxy-mcp", "none")` → `pix-frontend-vanilla-reactive` (oggi: `pix_frontend_vanilla_reactive`)
  - b) `formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "none")` → `pix-code-review` (oggi: `mcp__pix_galaxy_mcp__pix-code-review`)
  - c) Regressioni: le altre modalità invariate (`server`, `short`, `mcp`, default prompt)

## Phase 2 — Implementazione (`lib/_types.ts`)

- [ ] 2. `formatToolName`: con prefix `"none"` → nome nudo con `_`→`-` (1 riga)
- [ ] 3. `formatPromptCommandName`: con prefix `"none"` → `sanitizePromptName` nudo; altre modalità invariate

## Phase 3 — Config utente

- [ ] 4. `~/.pi/agent/mcp.json`: `"toolPrefix": "none"` per il server `pix-galaxy-mcp` (per-server, niente impatto su tokensave/mdn)
- [ ] 5. Verifica collisioni: `pix` (router), `pix-update`, prompt `pix-code-review` vs tool `pix-process-code-review` → nomi distinti

## Phase 4 — Docs + release

- [ ] 6. README del package: documentare il comportamento `"none"` (tool dash-separati, prompt nudi)
- [ ] 7. Bump versione 0.1.5 → 0.1.6 + tag (script release del repo) + publish npm
- [ ] 8. Pi aggiorna il package al riavvio (list `packages` in `~/.pi/agent/settings.json`)
