# pi-reasoning — pi.dev extension

Automatic reasoning level management for [pi.dev](https://pi.dev). Sets the
thinking/reasoning level based on the selected model with sensible defaults
for all major models.

No more manually adjusting reasoning every time you switch models —
`pi-reasoning` does it for you.

## Features

- **🧠 Auto-reasoning** — Model change → optimal thinking level applied instantly
- **📋 Sensible defaults** — Covers Claude, GPT, Gemini, DeepSeek, Llama, Mistral, Kimi, o-series
- **⚙️ `/reasoning` command** — Manual override, auto re-apply, or check current level
- **📊 Status bar indicator** — Colored dot + level always visible
- **🔌 Zero config** — Install and go

## Install

```bash
pi install npm:@pixu1980/pi-reasoning
```

Requires **Node.js ≥ 22** (uses `--experimental-strip-types`).

## How it works

When you switch models (via `/model`, `Ctrl+P`, or session restore), the
extension:

1. Checks if the new model supports reasoning
2. Looks up the model in its internal mapping table
3. Applies the corresponding thinking level
4. Updates the status bar with the current level

Non-reasoning models are handled by pi's built-in clamping (always `off`).

### Default mappings

| Model family | Thinking level |
|---|---|
| Claude Opus 4/3, o3, o4, DeepSeek R1 | `max` |
| Claude Sonnet 4/4.5, GPT-5, Gemini 2.5/3, DeepSeek, Kimi, QwQ | `high` |
| Claude 3 Sonnet, GPT-4o/4.1/4, Gemini 2.0 Pro, Llama 3/4, Mistral Large | `medium` |
| Claude Haiku/3 Haiku, GPT-4o-mini, Gemini 2.0 Flash, Mistral Small | `low` |
| GPT-4.1-mini | `minimal` |
| GPT-4.1-nano, GPT-4-mini | `off` |

Models not in the map get a heuristic guess based on their name
(`nano` → off, `mini`/`flash` → low, `large`/`pro` → high, else medium).

## Usage

### `/reasoning` — Show or set reasoning level

```
/reasoning                    Show current level
/reasoning auto               Re-apply auto-reasoning for current model
/reasoning high               Set specific level (off/minimal/low/medium/high/xhigh/max)
/reasoning reset              Restore default model mappings
/reasoning map                Show active model→level mappings
```

### Examples

```bash
# Check current level
/reasoning
# → "Reasoning: 🟡 medium"

# Switch to a reasoning model
/model claude-sonnet-4-20250514
# → Status bar: 🟠 claude-sonnet-...

# Override manually
/reasoning max
# → "Reasoning level → 💜 max"

# Re-apply auto after manual override
/reasoning auto
# → "Auto-reasoning → 🟠 high (anthropic/claude-sonnet-4-20250514)"

# See all mappings
/reasoning map
# → "Active mappings (24):
#      claude-opus-4            → max
#      claude-sonnet-4-5        → high
#      ..."
```

### Status bar indicator

The extension adds a status bar entry showing the current model and level:

| Indicator | Level |
|-----------|-------|
| ⚪ model | off |
| 🔵 model | minimal |
| 🟢 model | low |
| 🟡 model | medium |
| 🟠 model | high |
| 🔴 model | xhigh |
| 💜 model | max |

The status updates automatically on model change and level change.

## Customization

Want different mappings? The extension is designed for easy modification.
Edit `modelMap` in `index.ts` to add your own patterns, or use the
`/reasoning reset` command to restore defaults after experimenting.

### Pattern matching rules

- Patterns are matched as **case-insensitive substrings** against the model ID
- Entries are checked **in order** — first match wins
- Put more specific patterns before broader ones
- Optionally filter by **provider** (e.g. `providers: ["anthropic"]`)

### Example custom entries

```typescript
// Custom provider filter
{ pattern: "my-custom-model", level: "high", providers: ["my-provider"] },

// Broad family match (caught by more specific entries first)
{ pattern: "gpt", level: "medium" },
```

## Development

```bash
# From monorepo root
cd packages/pi-reasoning
pi -e .                  # Test locally
```

### Files

| File | Role |
|------|------|
| `index.ts` | Extension entry — model map, event handlers, /reasoning command |
| `package.json` | Package metadata, peer deps |
| `README.md` | This file |

## How it integrates

The extension uses two pi.dev lifecycle hooks:

1. **`model_select`** — Fired when the model changes. We look up the new model
   in our mapping and apply the corresponding thinking level.
2. **`thinking_level_select`** — Fired when the thinking level changes (from
   any source). We keep the status bar in sync.

The `pi.setThinkingLevel()` API handles clamping to model capabilities, so a
`max` setting on a non-reasoning model is safely ignored.

## Related

- [pi.dev extensions documentation](https://pi.dev/docs/extensions)
- [pi.dev models documentation](https://pi.dev/docs/models)

## License

MIT
