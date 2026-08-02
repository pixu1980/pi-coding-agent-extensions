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

Releases are performed locally: the command bumps the version, updates the
changelog, creates and pushes the package tag, then publishes the package to
npm. Authenticate with npm on the release machine before running it.

```bash
npm login

# Release changed packages (dry-run: add --dry-run)
pnpm release

# Install from pi
pi install npm:<name>
```

## Development

```bash
# From the monorepo root, test a package locally
cd packages/<name>
pi -e .
```

## License

MIT
