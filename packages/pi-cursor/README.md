# pi-cursor

> Cursor API key provider for [pi](https://pi.dev) — run Cursor agents from pi with **your own** Cursor API key.

```bash
pi install npm:@pixu1980/pi-cursor
```

## Why this exists

`pi-cursor-sdk` (upstream, by Mitch Fultz) is a thorough Cursor provider, but it
ships ~110 source files, an MCP tool bridge, a cloud-agent runtime, a usage
reporting path and a 40-script smoke harness. `pi-cursor` is the small,
auditable core: the Cursor API key, the Cursor models, and nothing else.

The full comparison is in [`docs/audits/pi-cursor-sdk-source-audit.md`](../../docs/audits/pi-cursor-sdk-source-audit.md).

## Features

- **`cursor` provider** — all Cursor models in pi's `/model` picker, discovered
  live from Cursor and cached locally for fast startup.
- **`/login cursor`** — paste your Cursor API key once; pi stores it in
  `~/.pi/agent/auth.json` (mode 0600), like every other provider.
- **Thinking levels** — Cursor's `effort` / `reasoning` / `thinking` parameters
  mapped onto pi's `off … max` levels, so `/think` works.
- **Context and speed variants** — `grok-4.6@200k`, `grok-4.6:fast`.
- **Local agents only** — the Cursor agent runs on your machine, in your cwd.
  No cloud agents, no PR creation, no repo upload.
- **No telemetry added by this extension** — zero requests are issued by
  pi-cursor itself. See [Egress](#egress).

## Install

```bash
pi install npm:@pixu1980/pi-cursor
```

Then, inside pi:

```
/login cursor          # paste your Cursor API key
/model                 # pick a Cursor model
```

Or use the environment variable instead of `/login`:

```bash
export CURSOR_API_KEY="..."   # machine-local only, never written by the extension
```

## Commands

| Command | What it does |
| --- | --- |
| `/cursor-models` | Refresh the live Cursor model catalog without restarting pi |
| `/cursor-egress` | Print the audited outbound surface and the backend-override state |
| `/cursor-key` | Print which key source is active, masked (`crsr…89 (48 chars)`) — never the key |

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `CURSOR_API_KEY` | — | API key fallback when nothing is stored via `/login cursor` |
| `PI_CURSOR_DISABLE_MODEL_CACHE` | `0` | `1` disables the catalog cache |
| `PI_CURSOR_MODEL_CACHE_TTL_MS` | `21600000` (6h) | Catalog cache freshness |
| `PI_CURSOR_LOG_EGRESS` | `0` | `1` prints the outbound surface to stderr at startup |
| `PI_CURSOR_ALLOW_BACKEND_OVERRIDE` | `0` | `1` permits `CURSOR_BACKEND_URL` outside the allowlist |

## Egress

pi-cursor ships **no HTTP client of its own** — there is no `fetch`, no
`http.request`, no third-party networking package. Everything on the wire is the
Cursor SDK, driven from three call sites:

| Host | Who calls it | What goes there |
| --- | --- | --- |
| `api2.cursor.sh` | Cursor SDK | API key exchange, agent run stream, model catalog, SDK run counters |
| `api.cursor.com` | Cursor SDK | Model catalog |

Call sites: `Cursor.models.list()` (model discovery), `Agent.create()` (one
local agent per pi session), `agent.send()` (one run per turn).

Your API key travels as a `Authorization: Bearer …` header to those two hosts
and nowhere else. Two guards back that up:

- `CURSOR_BACKEND_URL` is **refused** unless it resolves inside the allowlist,
  so a stray shell export cannot redirect your key to a third party. Opt in
  with `PI_CURSOR_ALLOW_BACKEND_OVERRIDE=1` if you run your own Cursor backend.
- Every string that can reach the transcript, an error, or stderr is scrubbed
  first, so the key cannot be echoed back by the SDK or by a failing request.

Run `/cursor-egress` at any time to see the current state, or read
[`DISCLOSURE`](./DISCLOSURE) for the precise statement.

## How turns are handled

The Cursor SDK runs a self-contained agent: **it** executes shell, read, edit and
search against your working directory. pi therefore treats a Cursor turn as a
single unit and shows the agent's tool activity as a display-only trace, rather
than handing pi `toolCall` blocks it would then execute a second time.

Consequence worth knowing: **pi's tool approval prompts do not apply to the
Cursor agent's own tools.** The agent runs with the permissions of the pi
process. If you need pi's tool layer in the loop, upstream `pi-cursor-sdk`'s MCP
bridge is the design you want.

Context handoff: on the first turn of a pi session the whole transcript is
handed to a freshly created Cursor agent; afterwards only the newest user
message is sent, because the agent already holds the earlier turns.

## Development

```bash
cd packages/pi-cursor
pnpm install
pnpm test        # 143 tests
pnpm typecheck   # tsc --noEmit
```

The suite covers the security invariants directly: the egress allowlist, the
refusal of a redirected backend, key scrubbing, the no-write guarantee for key
material, the cache containing no key-derived value, and a source-level audit
that fails if anyone adds a network API or a non-Cursor URL literal.

## Credits

Inspired by [`pi-cursor-sdk`](https://github.com/fitchmultz/pi-cursor-sdk)
(MIT, Mitch Fultz), which established the model-identity scheme and the
delta-to-pi stream mapping this extension follows.

## License

MIT
