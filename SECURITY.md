# Security Policy

This repository publishes eight `@pixu1980/pi-*` packages for the
[pi coding agent](https://pi.dev). They load into the pi process, so they run
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

Three of the eight packages are declared `dual-use` in their `package.json`
because they are built to reach outside the process. Their `DISCLOSURE` files
state what they can do and are the authoritative description.

### Network and process reach

- **`@pixu1980/pi-mcp`** is the widest surface. It spawns MCP servers as child
  processes that inherit the agent's environment, connects to remote HTTP and
  SSE endpoints including user-supplied URLs, runs a local HTTP callback server
  for OAuth, reads and writes OAuth tokens through the operating system keyring
  (`@napi-rs/keyring`), opens URLs in your browser, and relays tool calls from
  the model to every connected server.
- **`@pixu1980/pi-cursor`** carries your Cursor API key and sends it to
  `api2.cursor.sh` and `api.cursor.com` and nowhere else. It ships no HTTP client
  of its own, and source-level tests fail if any file under `lib/` gains
  `fetch(`, an `http`/`https` request, a socket, a WebSocket, `EventSource`, a
  third-party networking package or a `child_process` call, or if a URL literal
  names a host outside the allowlist. It writes no credential anywhere.
- **`@pixu1980/pi-web`** fetches URLs you give it and converts them to
  Markdown. Requests to private and reserved address ranges are blocked unless
  you allowlist them, pages are parsed with `linkedom` and never rendered, so
  script in a fetched page cannot execute, and every request carries a byte cap
  and a timeout.

The other five packages read pi's own session, settings and configuration files
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
message or stderr passes through `scrubSecrets` first. `@pixu1980/pi-mcp` stores
OAuth tokens in the operating system keyring rather than on disk. If you find a
package here logging, transmitting or persisting a secret it should not, that is
in scope and worth reporting.
