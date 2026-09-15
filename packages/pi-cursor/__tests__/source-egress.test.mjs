/**
 * pi-cursor - source-level egress audit
 *
 * The runtime tests prove behavior; this suite proves the code itself cannot
 * phone home. It is deliberately dumb and literal, grepping the source for
 * network APIs and for URL literals outside the allowlist, because the value
 * is in failing loudly when someone adds `fetch()` two years from now.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CURSOR_EGRESS_ALLOWLIST } from "../lib/_types.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const libDir = fileURLToPath(new URL("../lib/", import.meta.url));

/** Drop comments so a doc sentence cannot be mistaken for a call. */
function stripComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSource(path) {
  return { source: stripComments(readFileSync(path, "utf8")), raw: readFileSync(path, "utf8") };
}

function sourceFiles() {
  const files = readdirSync(libDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name: `lib/${name}`, ...readSource(`${libDir}${name}`) }));

  return [{ name: "index.ts", ...readSource(`${packageRoot}index.ts`) }, ...files];
}

describe("no network APIs in pi-cursor source", () => {
  const forbidden = [
    "fetch(",
    "XMLHttpRequest",
    "axios",
    "node-fetch",
    "sendBeacon",
    "WebSocket",
    "EventSource",
    "http.request",
    "https.request",
    "http.get(",
    "https.get(",
    "net.connect",
    "net.createConnection",
    "dns.lookup",
    "tls.connect",
    "undici",
  ];

  it("uses none of them", () => {
    for (const file of sourceFiles()) {
      for (const needle of forbidden) {
        assert.equal(file.source.includes(needle), false, `${file.name} must not use ${needle}`);
      }
    }
  });

  it("does not shell out", () => {
    for (const file of sourceFiles()) {
      for (const needle of ["child_process", "execSync", "spawnSync", "execFile"]) {
        assert.equal(file.source.includes(needle), false, `${file.name} must not use ${needle}`);
      }
    }
  });

  it("imports the Cursor SDK lazily only", () => {
    for (const file of sourceFiles()) {
      const staticImport = /^\s*import\s[^\n]*from\s+["']@cursor\/sdk["']/m.test(file.source);

      assert.equal(staticImport, false, `${file.name} must not statically import @cursor/sdk`);
    }
  });
});

describe("URL literals stay inside the allowlist", () => {
  it("contains no other host", () => {
    const allowed = new Set(CURSOR_EGRESS_ALLOWLIST);

    for (const file of sourceFiles()) {
      for (const match of file.source.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
        const host = match[1];

        assert.equal(allowed.has(host), true, `${file.name} references disallowed host ${host}`);
      }
    }
  });

  it("has an allowlist with no wildcard or scheme", () => {
    for (const host of CURSOR_EGRESS_ALLOWLIST) {
      assert.equal(host.includes("*"), false, `${host} must be an exact host`);
      assert.equal(host.includes("/"), false, `${host} must not carry a path`);
      assert.equal(host.includes(":"), false, `${host} must not carry a port`);
    }
  });
});

describe("the SDK's own credential store is never touched", () => {
  it("no source file references ~/.cursor", () => {
    for (const file of sourceFiles()) {
      assert.equal(file.source.includes(".cursor/sdk"), false, `${file.name} must not read the SDK auth file`);
      assert.equal(file.source.includes("~/.cursor"), false, `${file.name} must not read the SDK auth file`);
    }
  });
});
describe("secrets are not written to the console", () => {
  it("no console call mentions a key", () => {
    for (const file of sourceFiles()) {
      for (const match of file.source.matchAll(/console\.\w+\(([^\n]*)/g)) {
        assert.equal(
          /apiKey|api_key|CURSOR_API_KEY/i.test(match[1]),
          false,
          `${file.name} logs something key-shaped`,
        );
      }
    }
  });

  it("stderr diagnostics never interpolate a key variable", () => {
    for (const file of sourceFiles()) {
      for (const match of file.source.matchAll(/process\.(?:stderr|stdout)\.write\(([\s\S]{0,200}?)\)/g)) {
        assert.equal(/apiKey|\bkey\b/i.test(match[1]), false, `${file.name} writes a key-shaped value`);
      }
    }
  });
});
