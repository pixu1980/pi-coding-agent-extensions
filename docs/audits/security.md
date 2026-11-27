# security audit

- **Role**: security v2
- **Date**: 2026-11-27
- **Scope**: `Audit, review and plan`. The topic named no narrower surface. The run covered the ten packages, the root and the published registry state.

Status: `complete`.

Evidence only. Opinions belong in [the review](../reviews/security.md).

## 1. Environment

```console
$ node --version ; npm --version ; pnpm --version
v26.13.1
11.20.0
12.23.0
```

```console
$ pi --version
1.6.0
$ git log --oneline -1
dabab5c docs(oss): audit, review and plan
```

Ten directories under `packages/`. The host that runs them is `pi` 1.6.0.

## 2. Scope resolution

Topic text: `Audit, review and plan`. It names no package and no file. The surface is the
whole repository. One decision taken during the run changes the surface: `pi-remote` is removed,
so its findings close by removal.

## 3. SSRF guard in pi-web

This guard resolves each host and rejects private ranges. The probe below calls the module itself.

```console
$ node --import tsx _probe.mjs    # imports lib/_ssrf.ts, calls isBlockedAddress(ip, [])
true   127.0.0.1
true   10.1.2.3
true   169.254.169.254
true   ::1
true   ::ffff:127.0.0.1
true   fd00::1
```

```console
false  64:ff9b::7f00:1
false  64:ff9b::a9fe:a9fe
false  2002:7f00:1::
false  2001:0:0:0:0:0:7f00:1
false  17.0.0.1
false  2606:4700::1111
```

Four `false` values in the second block matter. `64:ff9b::7f00:1` is the NAT64 form of
`127.0.0.1`. `64:ff9b::a9fe:a9fe` is the NAT64 form of `169.254.169.254`, the cloud metadata
address. `2002:7f00:1::` is 6to4 and `2001:0:0:0:0:0:7f00:1` is Teredo. None of those four
prefixes appears in `DEFAULT_BLOCKED`, which lists 20 ranges.

Validation and connection are two separate steps here.

```console
$ grep -n "validateTargetHost\|await fetch(" packages/pi-web/lib/_fetch.ts
   validation = await validateTargetHost(hostname, allowRanges);
   res = await fetch(currentUrl, { redirect: 'manual', ... });
```

Global `fetch` resolves the name a second time. No custom dispatcher and no pinned address is passed.
The OWASP SSRF cheat sheet states the rule this breaks, quoted in §12.

## 4. Production dependency advisories

`npm audit` returns nothing here, because the packages use pnpm lockfiles. `pnpm audit --prod`
works.

| Package | low | moderate | high | critical |
| ------- | --- | -------- | ---- | -------- |
| pi-cursor | 3 | 9 | 7 | 0. |
| pi-mcp | 4 | 30 | 12 | 1. |
| pi-ask, pi-lyceum, pi-path-picker, pi-reasoning, pi-remote, pi-sessions, pi-statusline, pi-web | 0 | 0 | 0 | 0. |

Worst entries for `pi-cursor`. One production dependency pulls them in.

```console
high     undici <6.29.1     TLS certificate validation bypass via d...   >=6.29.1
high     undici <6.29.1     DoS via TLS 1.2 certificates              >=6.29.1
high     @fastify/busboy    DoS via prototype pollution               >=3.2.1
high     zod <4.6.6         memory exhaustion on constrained strings  >=4.6.6
moderate undici <6.24.0     HTTP request/response smuggling           >=6.24.0
```

Worst entries for `pi-mcp`:

```console
critical proxy-addr <2.0.8   IP spoofing via IPv4-mapped IPv6        >=2.0.8
high     @mcp/sdk 1.30.0     OAuth client sends credentials to wrong host  >=1.32.0
high     @mcp/client 2.0.0   same advisory                            >=2.2.0
high     fast-uri <3.1.7     SSRF via malformed authority             >=3.1.7
```

`pi-mcp` declares `@modelcontextprotocol/sdk` 1.30.0, `@modelcontextprotocol/client` 2.0.0 and
`zod` 4.6.5. It is `private` and `deprecated`, so no release can fix it.

## 5. Secrets and files on disk

Files written with explicit `0o600`:

| File | Where |
| ---- | ----- |
| `~/.pi/agent/remote/identity.json` | `pi-remote/lib/_identity.ts` lines 74, 77. |
| push subscriptions | `pi-remote/lib/_push.ts` lines 64, 67. |
| audit log | `pi-remote/lib/_audit.ts` line 66. |
| cursor cache | `pi-cursor/lib/_cache.ts` lines 232, 234. |
| guarded MCP output | `pi-mcp/lib/_mcp-output-guard.ts` line 453. |

Credential sources read, never written, by the two provider packages:

```console
pi-cursor: pi credential store (auth.json, mode 0600) or CURSOR_API_KEY
pi-lyceum: pi credential store only, masked for display
pi-mcp:    @napi-rs/keyring 2.1.0 present in dependencies
```

One writer recorded a project-local path at audit time. `pi-mcp` wrote its trace to
`<cwd>/.pi/mcp-traces/`. The event is metadata only, and it was already redacted:

```console
$ grep -n "redactTraceText" packages/pi-mcp/lib/_mcp-trace.ts
60: export function redactTraceText(value: string, maxLength = 160): string
125:    server: redactTraceText(server, 120),
133:    event.method = redactTraceText(message.method, 120);
```

`createMcpTraceEvent` copies direction, server, transport, kind, status, method, id and byte
count. It never copies `params` or `result`. The measured defects were the project-local path and
the absent `mode` on `appendFile`.

## 6. Untrusted content and the instruction boundary

`pi_web_fetch` returns remote page content into the model context. Its declared guidance:

```console
$ grep -n "promptGuidelines" -A5 packages/pi-web/lib/_extension.ts
   Use pi_web_fetch when the user wants a webpage's content added to the conversation context.
   Use pi_web_fetch(raw: true) for documentation/API pages where Readability strips tables or code blocks.
   Use pi_web_read to retrieve further slices of a page returned by pi_web_fetch.
```

No entry says the content is untrusted data. The tool description names the SSRF guard and stays
silent on injection.

Controls that do exist:

- `pi-mcp` UI server binds `127.0.0.1` and requires a session token on the URL and the POST body.
- The same server sets `Content-Security-Policy` when a value is configured.
- The OAuth callback server binds `localhost` and rejects a missing or unknown `state` value.

## 7. Runtime fetches and what verifies them

`pi-remote` dials a relay over TLS and authenticates the client with an Ed25519 signature.

```console
$ grep -rn "DEFAULT_RELAY_URL" packages/pi-remote/lib/_extension.ts
41:const DEFAULT_RELAY_URL = 'wss://relay-rp1.jacobmoura.work';
```

That relay is a third-party host. Its DISCLOSURE states the limit of the guarantee.

```console
DISCLOSURE: pi-remote does not claim end-to-end encryption beyond the relay's TLS
DISCLOSURE: a malicious relay could forge `ct` (base64, same trust as the channel)
```

No certificate pinning, no server signature check and no message size cap on inbound text.
`_protocol.ts` validates a string as non-empty only.

## 8. Error paths

```console
$ grep -n "String(err)" packages/pi-remote/lib/_extension.ts
250:  sendError('internal_error', `Failed to persist peer: ${String(err)}`);
320:  return `Could not reach the relay (${relayUrl()}): ${err.message}`;
```

That first line sends a raw error to the phone. A local filesystem path can ride along.
No redaction step exists in `pi-mcp/lib/_logger.ts`.

```console
$ grep -c "redact" packages/pi-mcp/lib/_logger.ts
0
```

## 9. Positive controls measured

```console
$ grep -rn "\beval(\|new Function(\|node:vm" packages/*/lib --include="*.ts" | wc -l
0
$ grep -rn "shell: *true" packages/*/lib --include="*.ts" | wc -l
0
$ git grep -nIE "(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" | wc -l
0
```

Other controls read in the code:

- Pairing token: 16 random bytes, single use, TTL clamped between 10 s and 600 s.
- Push subscription parser: requires `https`, a 65-byte P-256 point and curve membership.
- `pi-web` bounds: 2 MiB body cap, 30 s timeout, 5 redirects, 3 concurrent fetches.
- Command execution: `pi-mcp` uses `cross-spawn` and never a shell.
- Trace metadata: no payload is copied, and server and method pass `redactTraceText`.
- Graph scan: 1 `unwrap` outside tests, 0 `unsafe` blocks.

## 10. pi-remote removal facts

```console
$ npm view @pixu1980/pi-remote time --json
0.1.0 2026-10-01T13:10:28.084Z
0.1.1 2026-11-27T11:07:46.706Z
$ date -u
ven 27 nov 2026 12:21:46 UTC
```

0.1.1 is 1.2 h old, so it is inside the 72-hour window. 0.1.0 is 57 days old. The npm unpublish
policy allows either removal only when no package depends on it. Beyond 72 hours it also requires
fewer than 300 weekly downloads and a single maintainer.

```console
$ curl -s https://api.npmjs.org/downloads/point/last-week/@pixu1980/pi-remote
{"downloads":16,"start":"2026-11-20","end":"2026-11-26"}
$ npm view @pixu1980/pi-remote maintainers --json
["pixu1980 <pisuemiliano.1980@gmail.com>"]
```

16 weekly downloads and one maintainer meet both conditions for 0.1.0. Repo-side footprint:

```console
$ grep -rl "pi-remote" --include="*.md" --include="*.json" --include="*.mjs" . | grep -v node_modules | grep -v "^./packages/pi-remote/"
test/packaged-assets.test.mjs, README.md, SECURITY.md, docs/*, 8 CHANGELOG.md
$ git tag --list '@pixu1980/pi-remote@*'
@pixu1980/pi-remote@0.1.0
@pixu1980/pi-remote@0.1.1
$ grep -rn "pi-remote" packages/*/package.json | grep -v '"pi-remote"' | wc -l
0
```

`test/packaged-assets.test.mjs` line 24 asserts that `packages/pi-remote/web` icons exist. It fails
the moment the directory is deleted.

## 11. Code graph health (tokensave)

```console
$ tokensave_health
quality_signal 6281
acyclicity 0.9721 (15 edges in cycles) | depth 0.45 (max chain 20, ideal 9)
equality 0.3108 (gini 0.6892) | redundancy 0.7248 (dead 779 / 2831 fns)
modularity 0.9918 (122 components)
```

```console
$ tokensave_dsm
313 files, 538 edges, density 0.0055, 42 clusters, largest 51
$ tokensave_circular
6 cycles, 4 of them inside pi-mcp
```

```console
$ tokensave_coupling (fan_in)
packages/pi-mcp/lib/_types.ts 27 | test/harness.mjs 20 | packages/pi-mcp/lib/_utils.ts 20
```

```console
$ tokensave_hotspots
createMockPi 125 in | createMockCtx 110 in | executeCall 94 out | initializeMcp
```

`tokensave_test_risk` ranks the generated `pi-mcp/lib/_app-bridge.bundle.js` first, then
`installMcpAdapter` with complexity 228 and no test. The bundle is generated code (ADR 014).

## 12. Sources consulted

- rule-mcp `rule-backend-security`, summary mode: secrets, input validation, auth lifecycle.
- rule-mcp `rule-data-validation`, summary mode: validation patterns and library integration.
- npm Unpublish Policy, read in full for §10. The quoted rule:
  "no other packages in the npm Public Registry depend on it. it had less than 300 downloads over
  the last week. it has a single owner/maintainer".
- OWASP SSRF Prevention Cheat Sheet, read for §3. The quoted rule:
  "Validate the resolved destination IP addresses against the application's permitted networks,
  then ensure the HTTP client connects only to validated addresses. A second, unchecked DNS lookup
  between validation and connection can bypass these checks".
- tokensave tools cited in §11, plus `unsafe_patterns` and `hotspots`.

## 13. Out of scope observations

- On the audit machine the local `packages/pi-statusline` sits in `.pi/settings.json`. That is
  machine state, not repository state.
- `docs/audits/oss.md` already records repository-level findings. This run does not repeat them.

## 14. Changes executed by this run

This run executed the plan on the maintainer's instruction. The commands below ran after the evidence above.

```console
$ git rm -r packages/pi-remote ; rm -rf packages/pi-remote
$ GIT_CONFIG_GLOBAL=/dev/null pnpm test:all
9 packages, 0 failed: pi-ask 101, pi-cursor 166, pi-lyceum 47, pi-mcp 47,
pi-path-picker 42, pi-reasoning 59, pi-sessions 34, pi-statusline 80, pi-web 35
```

```console
$ node --import tsx _probe.mjs    # isBlockedAddress after the range fix
true 64:ff9b::7f00:1     true 64:ff9b::a9fe:a9fe
true 2002:7f00:1::       true 2001:0:0:0:0:0:7f00:1
```

```console
$ cd packages/pi-web && pnpm add --save-exact undici@8.13.1
$ pnpm audit --prod
No known vulnerabilities found
$ node --import tsx --test __tests__/index.test.mjs
tests 35 | pass 35 | fail 0
```

```console
$ cd packages/pi-cursor && pnpm add --save-exact @cursor/sdk@1.5.2
$ pnpm add --save-exact zod@4.6.7
$ pnpm audit --prod
No known vulnerabilities found
$ node --import tsx --test __tests__/index.test.mjs
tests 166 | pass 166 | fail 0
```

```console
$ cd packages/pi-mcp && node --import tsx --test __tests__/index.test.mjs
tests 47 | pass 47 | fail 0        (+5 trace tests)
```

```console
$ pnpm test        # root, after the pi-remote icon test was removed
tests 41 | pass 41 | fail 0
$ pnpm lint
Checked 193 files. Found 1 info.
$ pnpm format:check
All matched files use Prettier code style!
```

Two steps stayed with the maintainer because they need the npm one-time password:
`npm unpublish @pixu1980/pi-remote --force`, `npm deprecate` on `pi-mcp`, and `pnpm release`.
