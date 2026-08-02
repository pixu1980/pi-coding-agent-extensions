# pi-coding-agent-extensions

Monorepo of extensions, themes, skills, and prompts for [pi.dev](https://pi.dev).

## Structure

```
packages/
├── pi-mcp/               # MCP adapter with tool advisory threshold
├── pi-path-picker/       # Interactive file path autocomplete
├── pi-reasoning/         # Reasoning/effort controls
├── pi-sessions/          # Session history overlay with auto-naming
├── pi-statusline/        # Custom status line
├── pi-web/               # URL → Markdown scraper (inspired by pi-web-access)
└── ...                   # More packages
```

## Publishing

Each package in `packages/` is **independently versioned and published** to npm.
Every package includes the `pi-package` keyword for automatic discovery on the [pi.dev gallery](https://pi.dev/packages).

Releases create and push a package tag locally; publication is completed by
`.github/workflows/publish.yml` through npm trusted publishing. No npm
credentials are stored in this repository or required on the release machine.

```bash
# Release changed packages (dry-run: add --dry-run)
pnpm release

# Install from pi
pi install npm:<name>
```

Before the first release of each package, configure its npm Trusted Publisher
with: user `pixu1980`, repository `pi-coding-agent-extensions`, workflow filename
`publish.yml`, and the `npm publish` action enabled. Repeat this once per npm
package.

## Development

```bash
# From the monorepo root, test a package locally
cd packages/<name>
pi -e .
```

## License

MIT
