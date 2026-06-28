# pi-coding-agent-extensions

Monorepo of extensions, themes, skills, and prompts for [pi.dev](https://pi.dev).

## Structure

```
packages/
├── pi-path-picker/      # Interactive file path autocomplete
├── ...                  # More packages
```

## Publishing

Each package in `packages/` is **independently versioned and published** to npm.
Every package includes the `pi-package` keyword for automatic discovery on the [pi.dev gallery](https://pi.dev/packages).

```bash
# Publish a single package
cd packages/<name>
npm publish

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
