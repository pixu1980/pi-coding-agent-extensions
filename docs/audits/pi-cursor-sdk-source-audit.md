# pi-cursor-sdk — source audit

- **Role**: supply-chain / egress review
- **Date**: 2026-09-15
- **Subject**: `https://github.com/fitchmultz/pi-cursor-sdk` @ `a8fecf1`, package version `0.3.6`
- **Dependency under review**: `@cursor/sdk@1.0.27`
- **Outcome**: `@pixu1980/pi-cursor` (`packages/pi-cursor`) — a reduced, audited
  re-implementation. This document records what was found and what was dropped.

Evidence only: the commands this run executed, the files it read, the outputs it
observed. Claims that could not be verified are marked as such.

## 1. Method

```bash
git clone --depth 50 https://github.com/fitchmultz/pi-cursor-sdk.git
grep -rnoE "https?://[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+" src/
grep -rn "fetch(\|http\.request\|https\.request\|axios\|new URL(\|WebSocket\|sendBeacon" src/
grep -rniE "telemetry|analytics|posthog|sentry|mixpanel|segment\.|datadog|bugsnag" --include="*.ts" --include="*.mjs" --include="*.js" .
grep -rhoE "process\.env\.[A-Z0-9_]+" src/ scripts/ shared/ | sort | uniq -c | sort -rn
npm install @cursor/sdk@1.0.27    # in a scratch dir, then instrumented probes
```

The SDK was additionally exercised under an instrumented `fetch` / `http.request`
/ `https.request` / `dns.lookup`:

```js
await import("@cursor/sdk");
await Cursor.models.list({ apiKey: "FAKE_KEY_FOR_AUDIT" });
await Agent.create({ apiKey: "FAKE_KEY_FOR_AUDIT", model: { id: "grok-4.6" }, local: { cwd } });
```

## 2. Shape

| Metric | Value |
| --- | --- |
| `src/*.ts` | 110 files, largest `cursor-fallback-models.generated.ts` (104 KB) |
| `test/*.test.ts` | 130+ files |
| `scripts/` | 40+ files incl. `platform-smoke/` (PTY capture, Playwright, a C `.c` extractor, `platform-build-windows.ps1`) |
| Runtime deps | `@cursor/sdk`, `@hono/node-server`, `@modelcontextprotocol/sdk` |
| Egress hosts in `src/` | `api.cursor.com`, `127.0.0.1` (loopback bridge) |

No `.github/` directory, therefore no CI workflows shipping secrets.

## 3. Findings

### 3.1 No third-party telemetry in the extension ✅

`grep -rniE "telemetry|analytics|posthog|sentry|mixpanel|datadog|bugsnag"` over
`.ts/.mjs/.js` matches only test names and unrelated identifiers (`previousEntryId`,
`shutdown.track`). The extension adds no analytics of its own.

### 3.2 Two outbound surfaces in `src/` ⚠️

| Site | File | Verdict |
| --- | --- | --- |
| `GET https://api.cursor.com/v1/agents/{id}/usage` | `cursor-cloud-reporting.ts:151` | Cursor-owned, but **redundant**: `collectCursorCloudRunReport` only calls it when `agent.getUsage()` is unavailable. Dropped in pi-cursor. |
| Loopback MCP bridge | `cursor-pi-tool-bridge-server.ts` | `server.listen(0, "127.0.0.1")`, rejects non-loopback peers (`req.socket.localAddress !== LOOPBACK_HOST` → 403), token-gated path. Correctly built, but it exists to expose pi's `read`/`bash`/`write`/`edit`/`grep`/`find`/`ls` to the Cursor agent. Dropped in pi-cursor (the Cursor agent has its own tools). |

`index.ts:39` (`baseUrl: "https://cursor.com"`) is a display/authority URL, not a
request target.

### 3.3 `@cursor/sdk@1.0.27` bundles a Statsig client — but it is inert ✅

The published bundle depends on `@statsig/js-client@3.31.0` and contains
`analytics.d.ts`, `sdk-statsig.d.ts`, `pr-opened-telemetry.d.ts`. Four hosts
appear in `dist/`: `statsigapi.net`, `featureassets.org`, `api.statsigcdn.com`,
`prodregistryv2.org` (plus `api2.cursor.sh`, `api.cursor.com`).

Reading the compiled `src/agent/sdk-statsig.ts` in the bundle shows the client is
constructed with network traffic disabled:

```js
const r = new n.StatsigClient("client-Bm4…", bootstrapUser, {
  disableLogging: true,
  disableStorage: true,
  networkConfig: { preventAllNetworkTraffic: true },
});
r.dataAdapter.setData(t);
r.initializeSync();
```

The config it evaluates comes from Cursor's own backend
(`POST ${backend}/aiserver.v1.AnalyticsService/BootstrapStatsig`). So the Statsig
endpoints are compiled in but **not reachable in this configuration**. Verified
by reading the bundle, not by observing a live run with a valid key.

### 3.4 The SDK does report anonymous run counters to Cursor ⚠️

`src/agent/analytics.ts`, compiled into `dist/esm/index.js`:

```js
function U(e, t, n) {
  const r = Lc(e);                       // apiKey, CURSOR_API_KEY, or stored login
  if (r) { getOrCreateClient(r).track(t, props); }
}
U(apiKey, "sdk.run.created",      props);
U(apiKey, "sdk.run.completed",    props);
U(apiKey, "sdk.operation.failed", { operation: "agent.send", error_type, error_code, error_status, … });
U(apiKey, "sdk.run.send_latency", props);
U(apiKey, "sdk.executor.startup", props);
U(apiKey, "sdk.request.pr_opened", props);
```

Transport is `createClient(aiserver.v1.AnalyticsService)` against
`process.env.CURSOR_BACKEND_URL ?? "https://api2.cursor.sh"`. Base props are
`{ surface: "sdk", sdk_version, os_platform, os_arch }`.

- Destination is **Cursor's own backend**, not a third party.
- Payload carries **no prompt, file content, or credential**; the API key is only
  the bearer token.
- **`sdk.request.pr_opened` is the notable one**: it probes the working tree /
  PR providers to detect open pull requests and links them to the agent session.
  Repo and PR identifiers leave the machine. It is Cursor-bound, but it inspects
  the user's repository without being asked.
- There is no client-side switch to disable any of this. `flushSdkAnalytics()` is
  reachable only through `agent[Symbol.asyncDispose]()`.

**Verdict**: disclosed, not removable without forking the SDK. pi-cursor
documents it, keeps it inside the allowlist, and adds nothing of its own.

### 3.5 `CURSOR_BACKEND_URL` is an unguarded redirect ⚠️ → hardened

The SDK reads `CURSOR_BACKEND_URL` for every backend call. Nothing in
`pi-cursor-sdk` validates it, so a stray export would send the user's API key to
an arbitrary host with no prompt.

**pi-cursor fix**: `checkBackendOverride()` refuses to resolve the key at all
when the override is outside `api.cursor.com` / `api2.cursor.sh`, and the auth
`resolve()` returns `undefined` in that case — fail closed. Escape hatch:
`PI_CURSOR_ALLOW_BACKEND_OVERRIDE=1`. Covered by tests.

### 3.6 Upstream caches a SHA-256 fingerprint of the API key ⚠️ → removed

`src/model-list-cache.ts` writes:

```json
{ "version": 1, "fetchedAt": …, "keyFingerprint": "<sha256(key)>", "models": [ … ] }
```

`createHash("sha256").update(apiKey)` — a plain, unsalted hash of the API key in
a world-readable-by-default cache file. Anyone with read access to
`~/.pi/agent/cursor-sdk-model-list.json` gets an offline oracle to confirm a
guessed or leaked key.

**pi-cursor fix**: `lib/_cache.ts` stores `{ version, fetchedAt, models }` only.
A test reads the written file back and asserts none of
`apiKey`/`api_key`/`keyFingerprint`/`fingerprint`/`token`/`credential` appears.
The cache path is also renamed (`pi-cursor-models.json`) and written mode `0600`.

### 3.7 Key handling in the extension is otherwise local ✅

`src/cursor-api-key.ts` reads pi's credential store
(`readStoredCredential("cursor")`) and `CURSOR_API_KEY`, keeps a non-secret
sentinel in the provider registry so models stay visible before `/login`, and
writes nothing. `shared/cursor-sensitive-text.mjs` provides a real scrubber for
bearer tokens, URL userinfo, cookies and `api_key=` spans.

**pi-cursor** keeps the same precedence and the same sentinel idea, drops the
extra indirection, and re-implements the scrubber (plus a test that asserts it).

### 3.8 Bundle and maintenance surface ⚠️ → reduced

Not a vulnerability, but a review cost: 110 source files and 130+ test files for
"use my Cursor key in pi". `platform-smoke/` alone spawns PTYs, drives Playwright,
compiles a C executable via `cc`, and calls `taskkill.exe` / `powershell.exe` on
Windows. None of it runs at chat time (it is `npm run smoke:*` only), but it is
code shipped in the published tarball (`files` lists most of `scripts/`).

**pi-cursor** ships 9 `lib` modules (8 implementation + 1 barrel), one package
barrel, and 10 test files.

## 4. What pi-cursor drops

| Dropped | Reason |
| --- | --- |
| Cloud agents (`cursor-cloud-*`, 5 files) | Uploads the repo to Cursor's cloud; the user asked for API-key support, not remote execution |
| Pi tool bridge + MCP server (7 files) | Loopback HTTP server exposing pi's tools; the Cursor agent already has tools |
| Cloud usage reporting | Redundant with the run's own usage |
| `@hono/node-server`, `@modelcontextprotocol/sdk` deps | Only needed by the two items above |
| 40-script smoke harness, Playwright, node-pty, xterm | Maintainer tooling that was being published |
| Alias-based model ids | Ambiguity rules that hide which model actually runs |
| Key fingerprint cache | Secret-derived value at rest |

## 5. Residual risk, stated plainly

| Risk | Status |
| --- | --- |
| Cursor SDK sends anonymous run counters to `api2.cursor.sh`, incl. PR detection | Not removable client-side. Disclosed in `DISCLOSURE`. Cursor-bound. |
| Cursor SDK is a minified webpack bundle; the Statsig verdict rests on reading that bundle | Verified statically, **not** with a live valid key. Flagged. |
| Cursor agent executes shell/edits itself, outside pi's approval layer | Inherent to the SDK's local-agent design. Documented in the README. |
| `@cursor/sdk` is Cursor-proprietary (`LICENSE.md`: "© Anysphere Inc. All rights reserved") | Not a security risk; a licensing fact worth knowing before redistribution. |

## 6. Resulting artifact

`packages/pi-cursor` — `@pixu1980/pi-cursor@0.1.0`

```bash
cd packages/pi-cursor
pnpm test        # 143 tests, 143 pass
pnpm typecheck   # tsc --noEmit, clean
```

The suite asserts the invariants this audit produced: the egress allowlist, the
refusal of a redirected backend, key scrubbing, no write of key material, a cache
free of key-derived values, one agent per session with disposal, and a
source-level audit that fails if a network API or a non-Cursor URL literal is
ever added to the extension.
