# pi-path-picker — pi.dev extension

Interactive file path autocomplete inside the TUI prompt.  
Tab-complete `~`, `/`, `./`, `../` paths with fuzzy filtering — only inside quotes (`"`, `'`, `` ` ``).

No `/pick` command. No external tool. Pure inline completion.

## Install

```bash
pi install npm:@pixu1980/pi-path-picker
```

Requires **Node.js ≥ 22** (uses `--experimental-strip-types`).

## Interaction modes

Path autocomplete fires **only on Tab**, inside a closed pair of double quotes, single quotes, or backticks, and only when the quoted path token contains `/`.

The extension adds no trigger characters of its own. When no quoted context is present it delegates transparently to pi's native provider, so built-in commands (`/model`, `/settings`, `/caveman`, etc.), `@file`, command arguments, and native Tab completion behave exactly as if `pi-path-picker` were not installed.

An incomplete quote context (opening or closing delimiter missing) is intentionally not delegated: it returns no suggestions so any open path menu closes immediately.

### 1. `~` / `~/` — Home directory expansion

Type `~/` inside quotes and press Tab → file list from `$HOME`.

```
"~/|" + Tab        →  shows home-directory contents
"~/.ssh/|" + Tab   →  suppressed (sensitive directory guard)
```

### 2. `/` — Absolute path browsing

Type `/` inside quotes and press Tab → list filesystem root contents.

```
"/|" + Tab         →  root contents
"/etc/ssh/|" + Tab →  suppressed (sensitive directory guard)
```

### 3. `./` and `../` — Relative path browsing

Type `./` or `../` inside quotes and press Tab → navigate from project root or parent directories.

```
"./src/|" + Tab    →  contents of ./src/
"../../|" + Tab    →  contents two levels above
```

### 4. Tab key — Force trigger

Tab is the **only** path-picker trigger. It opens the menu only when:

1. the cursor is inside a closed pair of `"`, `'`, or `` ` ``;
2. the extracted path token contains `/` (`~/`, `/`, `./`, `../`, or a descendant path).

Typing `~`, `/`, a quote, or a backtick never opens the path menu by itself.

### 5. Fuzzy filter

As you type after a path prefix, results are filtered by **prefix match** (case-insensitive).
Hidden files (`.`-prefixed) are hidden unless your query also starts with `.`.

### 6. Paths with spaces

Fully supported. The extension captures the entire text between quotes, including spaces,
so paths like `"./My Projects/"` complete correctly.

## Sensitive directory guard

These directories are blocked from listing to prevent accidental exposure:

| Path |
|---|
| `~/.ssh` |
| `~/.aws` |
| `~/.config/gh` |
| `~/.gnupg` |
| `~/.password-store` |
| `~/.kube` |
| `/etc/ssh` |

Users can still navigate into them via other means — only the autocomplete list is suppressed.

## How it works

The extension registers an **autocomplete provider** via pi's `session_start` hook.
It wraps pi's native provider and adds path-aware completion.

### Autocomplete isolation contract

The provider follows one ownership rule:

1. **No custom trigger characters** — the wrapper passes through the native provider's trigger list unchanged.
2. **Inside a closed quote pair + Tab + token containing `/`** — `pi-path-picker` owns suggestions and completion.
3. **Inside a closed quote pair without Tab or without `/`** — returns no path suggestions, closing any stale menu.
4. **Broken quote pair** — returns no suggestions and forces a refresh, so deleting either delimiter closes the menu like Escape.
5. **No quoted context** — delegates `getSuggestions`, `shouldTriggerFileCompletion`, and `applyCompletion` to the wrapped native provider without altering arguments or results.

This delegation is required because `addAutocompleteProvider()` creates a wrapper chain: returning `null` outside the owned context would stop native slash-command completion.

Inside quote pairs, the extension resolves paths against `cwd` or `$HOME`, lists matching files/directories, and returns autocomplete items with `📁` / `📄` labels.

## Development

```bash
# From monorepo root
cd packages/pi-path-picker
pi -e .         # Test locally
node index.test.cjs   # Run tests
```

## Files

| File | Role |
|------|------|
| `index.ts` | Extension entry — registers autocomplete provider via `session_start` |
| `pick-path.ts` | Standalone helper — interactive TUI browser (`--quick` for glob), used by the extension internally |

## Pick-path CLI (`pick-path.ts`)

The helper script can also run standalone as a terminal UI:

```bash
node --experimental-strip-types pick-path.ts              # Interactive browser
node --experimental-strip-types pick-path.ts --quick *    # Quick glob match (stdout)
echo "src" | node --experimental-strip-types pick-path.ts # Pipe start directory
```

Keys inside the interactive browser:

| Key | Action |
|-----|--------|
| `↑↓` | Navigate |
| `↵` | Select file / select directory |
| `⭾` | Enter directory |
| `←` | Go up to parent |
| `⎋` | Cancel |
| Type | Fuzzy filter |
| `⌫` | Clear filter |

## License

MIT
