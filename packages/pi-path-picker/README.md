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

All autocomplete triggers fire **only inside double quotes, single quotes, or backticks**.
Outside quotes the extension stays silent so it never interferes with native command completion or pi.dev commands (`/model`, `/caveman`, etc.).

### 1. `~` / `~/` — Home directory expansion

Type `~` or `~/` inside quotes → immediate file list from `$HOME`.

```
"~/Desk|"          →  shows Desktop/, Documents/, ...
"~/.ssh|"          →  suppressed (sensitive directory guard)
```

### 2. `/` — Absolute path browsing

Type `/` inside quotes → list filesystem root contents. Continue typing to drill down.

```
"/u|"              →  /usr/, /Users/
"/etc/ssh|"        →  suppressed (sensitive directory guard)
```

### 3. `./` and `../` — Relative path browsing

Type `./` or `../` inside quotes → navigate from project root / parent dirs.

```
"./src/comp|"      →  ./src/components/, ./src/composables/
"../../oth|"       →  ../../other-stuff/
```

### 4. Tab key — Force trigger

Pressing Tab inside quotes with any path prefix (`~/`, `/`, `./`, `../`) opens the
autocomplete list.

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

**Outside quotes** — delegates to native provider for `/`-prefixed commands
(`/model`, `/caveman`), returns `null` for everything else (closes stale menus when
cursor leaves a quoted region).

**Inside quotes** — extracts the path token before the cursor (`~...`, `/...`, `./...`,
`../...`), resolves it against `cwd` or `$HOME`, lists matching files/dirs, and returns
autocomplete items with `📁` / `📄` labels.

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
