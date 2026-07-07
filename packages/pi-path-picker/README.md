# pi-path-picker - pi.dev extension

Interactive file path autocomplete with arrow-key navigation and fuzzy matching. Works like ohmyzsh's tab completion but from within the agent.

## Install

```bash
pi install npm:@pixu1980/pi-path-picker
```

## Commands

| Command | Description |
|---------|-------------|
| `/pick` | Interactive path browser with arrow keys, fuzzy filter, Tab/Enter |

## Usage

### Interactive command

```
/pick src/components              # Browse from src/components
/pick                             # Browse from current directory
/pick ~/.config                   # Browse from home config
```

## Files

- `index.ts` - Extension entry point (auto-discovered by pi)
- `pick-path.ts` - Helper script for file listing and glob resolution (TypeScript)
