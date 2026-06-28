# pi-path-picker — pi.dev Extension

Interactive file path autocomplete with arrow-key navigation and fuzzy matching. Works like ohmyzsh's tab completion but from within the agent.

## Install

```bash
pi install npm:pi-path-picker
```

## Commands

| Command | Description |
|---------|-------------|
| `/pick` | Interactive path browser with arrow keys, fuzzy filter, Tab/Enter |

## Tools

| Tool | Description |
|------|-------------|
| `path_pick` | Programmatic path autocomplete for the LLM. Supports fuzzy and glob modes. |

## Usage

### Agent tool

The LLM automatically uses `path_pick` when you ask:
- "find the file with the button component"
- "where is the test file for utils?"
- "I need to reference the config file"

### Interactive command

```
/pick src/components              # Browse from src/components
/pick                             # Browse from current directory
/pick ~/.config                   # Browse from home config
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Partial filename, path, or glob pattern |
| `root` | string | `.` | Root directory |
| `maxResults` | number | 20 | Max results (max 100) |
| `mode` | "fuzzy" | "glob" | Fuzzy name match or glob pattern |

## Files

- `index.ts` — Extension entry point (auto-discovered by pi)
- `pick-path.ts` — Helper script for file listing and glob resolution (TypeScript)
