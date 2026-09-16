# pi-coding-agent-extensions

Eight extensions for the [pi coding agent](https://pi.dev), published
independently to npm under the `@pixu1980` scope.

## Packages

| Package | What it does |
| ------- | ------------ |
| [`@pixu1980/pi-ask`](./packages/pi-ask) | Interactive multiple-choice questions for the agent, with notes and custom answers |
| [`@pixu1980/pi-cursor`](./packages/pi-cursor) | Run Cursor's own agents from pi using your Cursor API key |
| [`@pixu1980/pi-mcp`](./packages/pi-mcp) | Model Context Protocol adapter with a configurable tool advisory threshold, a fork of `pi-mcp-adapter` |
| [`@pixu1980/pi-path-picker`](./packages/pi-path-picker) | Interactive file path autocomplete with fuzzy matching and Tab completion |
| [`@pixu1980/pi-reasoning`](./packages/pi-reasoning) | Sets the thinking level from the selected model, with per-model overrides |
| [`@pixu1980/pi-sessions`](./packages/pi-sessions) | Browse, search and restore past sessions, with auto-naming |
| [`@pixu1980/pi-statusline`](./packages/pi-statusline) | A customizable status line with git state, model info and context usage |
| [`@pixu1980/pi-web`](./packages/pi-web) | Fetches a URL and turns it into clean Markdown for the context |

Install one with pi:

```bash
pi install npm:@pixu1980/pi-statusline
```

Each package carries the `pi-package` keyword, so it also appears on the
[pi.dev gallery](https://pi.dev/packages). Node 22.19.0 or newer is required,
which is the version pi itself requires.

## Repository layout

Each directory under `packages/` is a standalone pnpm project with its own
manifest, lockfile and test suite. The repository root is a script runner rather
than a workspace, which is why there is no root workspace glob: see
[CONTRIBUTING.md](./CONTRIBUTING.md) for what that means in practice.

## Development

```bash
# Run every package's suite in one go, from the repository root
pnpm test:all

# Work on one package against a local pi
cd packages/<name>
pnpm install
pi -e .
```

## Publishing

Releases are cut from a maintainer machine, with no CI, by decision recorded in
[ADR 013](./docs/adr/013-publish-locally-without-ci-and-accept-the-provenance-gap.md).
That record also states what the resulting provenance gap costs a consumer.

```bash
npm login

# Release the packages with changes since their last tag
pnpm release

# Simulate it first
pnpm release:dry
```

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md),
which covers the local setup, the four gates you are expected to run, the commit
convention the changelogs are generated from, and the contribution terms.
[GOVERNANCE.md](./GOVERNANCE.md) says who decides what, how a decision becomes a
record in `docs/adr/`, and what this model costs.

Everyone taking part is expected to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

Report a vulnerability privately rather than in a public issue:
[SECURITY.md](./SECURITY.md) names the channel, the supported versions and what
each package can reach.

## License

`MIT`
