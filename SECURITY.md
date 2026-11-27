# Security Policy

This repository publishes eight `@pixu1980/pi-*` packages for the
[pi coding agent](https://pi.dev); a tenth, `@pixu1980/pi-mcp`, is deprecated.
They load into the pi process, so they run
with the privileges you gave pi and they can reach whatever pi can reach.

## Supported versions

Every package here is versioned and published independently, and **only the
latest published version of each package is supported**. A fix ships as a new
patch release of the package that needs it; older versions receive no backports.

Check the current version of a package with `npm view @pixu1980/<name> version`,
and update with `pi install npm:@pixu1980/<name>`.

## Reporting a vulnerability

Report privately, never in a public issue, through GitHub's private
vulnerability reporting for this repository:

`https://github.com/pixu1980/pi-coding-agent-extensions/security/advisories/new`

If that page is not available to you, open an issue that says only that you have
a security report and no details, and a private channel will be arranged.

**We acknowledge a report within 3 working days.** After that, the report is
confirmed or dismissed, and you are told which. This is a single-maintainer
project, so the timeline covers acknowledgment and triage rather than a
guaranteed fix date.

## What is in scope

Anything that lets a package here do something the user did not ask for:
exfiltrating a credential, reaching a host it should not reach, executing code
it should not execute, or weakening a guard the package documents. Prompt
injection that escapes a package's own boundary counts. A model saying something
wrong does not.

## Trust boundary

Three of the eight supported packages are declared `dual-use` in their
`package.json` because they are built to reach outside the process. Their
`DISCLOSURE` files state what they can do and are the authoritative description.
`@pixu1980/pi-mcp` is dual-use too but deprecated, and pi no longer installs it
by default.

### Network and process reach

- **`@pixu1980/pi-mcp`** (deprecated; superseded by pi's built-in MCP support,
  see [ADR 017](./docs/adr/017-deprecate-pi-mcp-in-favor-of-pi-s-built-in-mcp-support.md))
  is the widest surface. It spawns MCP servers as child
  processes that inherit the agent's environment, connects to remote HTTP and
  SSE endpoints including user-supplied URLs, runs a local HTTP callback server
  for OAuth, reads and writes OAuth tokens through the operating system keyring
  (`@napi-rs/keyring`), opens URLs in your browser, and relays tool calls from
  the model to every connected server. It is kept for the record only: it is
  skipped by the release loop and no new versions are published, so it receives
  no further security fixes. `pnpm audit --prod` reports 1 critical and 12 high
  advisories in its dependency tree, including an OAuth client that can send
  credentials to the wrong host; no release can fix them. Run
  `pi remove npm:@pixu1980/pi-mcp` if it is still installed.
- **`@pixu1980/pi-cursor`** carries your Cursor API key and sends it to
  `api2.cursor.sh` and `api.cursor.com` and nowhere else. It ships no HTTP client
  of its own, and source-level tests fail if any file under `lib/` gains
  `fetch(`, an `http`/`https` request, a socket, a WebSocket, `EventSource`, a
  third-party networking package or a `child_process` call, or if a URL literal
  names a host outside the allowlist. It writes no credential anywhere.
- **`@pixu1980/pi-lyceum`** carries your Lyceum API key and sends it to
  `api.lyceum.technology` and nowhere else: `GET /models` for the catalog
  refresh and, through pi's own `openai-completions` implementation, every chat
  turn. Its discovery call refuses redirects, checks the final URL against the
  host allowlist, caps the body and honors a timeout and pi's abort signal.
  Source-level tests fail if a second host, a `fetch` outside the discovery
  module, a process spawn, a filesystem write or an environment variable appears
  in the source. It writes no credential anywhere and has no environment
  fallback for the key.
- **`@pixu1980/pi-web`** fetches URLs you give it and converts them to
  Markdown. Requests to private, reserved and IPv4-IPv6 transition address
  ranges are blocked unless you allowlist them, the connection dials only the
  address the guard approved, pages are parsed with `linkedom` and never
  rendered, so script in a fetched page cannot execute, and every request
  carries a byte cap and a timeout. Fetched content is data: the tool tells the
  model to report an embedded instruction, not to follow it.

The other four packages read pi's own session, settings and configuration files
and write to pi's state. They do not open sockets.

### Release integrity

Know what you are trusting when you install:

- **No package carries a provenance attestation.** All eight were published from
  a developer machine with a personal npm credential, not from CI, so npm cannot
  show you a signed link between the published tarball and this repository. A
  consumer who requires provenance should not install these packages.
- **Tags are lightweight and unsigned**, so a tag alone does not authenticate a
  release.
- There is no CI in this repository. The test and lint gates are run by hand by
  the maintainer before a release, and you can re-run them yourself: `pnpm test`,
  `pnpm test:all`, `pnpm lint` and `pnpm format:check`.
- Dependency versions are pinned exactly in every manifest and a lockfile ships
  per package, but this repository configures **no release-age cooldown**, so a
  dependency compromised upstream can reach a release quickly. That tradeoff is
  recorded in `docs/adr/012-remove-the-dependency-cooldown-and-consume-the-newest-dependency-versions.md`.

## Handling of your credentials

Credential handling is per package. `@pixu1980/pi-cursor` documents its
guarantees field by field in its `DISCLOSURE`, including that it writes no
credential anywhere and that every string reaching the transcript, an error
message or stderr passes through `scrubSecrets` first. `@pixu1980/pi-lyceum`
documents its guarantees the same way: the key is read from pi's credential
store only, is never written, cached or logged by the extension, and the only
key-shaped string it can print is a masked label. `@pixu1980/pi-mcp`, while
it was supported, stored OAuth tokens in the operating system keyring rather than
on disk; the deprecated package is unsupported and receives no fixes. If you find a
package here logging, transmitting or persisting a secret it should not, that is
in scope and worth reporting.

What this repository writes to disk, and with which permissions:

- **Agent credentials** stay in pi's own credential store, `~/.pi/agent/auth.json`
  (`0600`), written by `/login`. The provider packages read it and never write it.
- **Extension state** is created owner-only: `pi-cursor`'s catalog cache, the
  guarded MCP output and, in `pi-mcp`, the trace files. MCP traces now live under
  `~/.pi/agent/mcp-traces/` with mode `0600`, and they record message metadata
  only: method, direction, status, byte count and a redacted id. A tool argument
  never reaches a trace.
