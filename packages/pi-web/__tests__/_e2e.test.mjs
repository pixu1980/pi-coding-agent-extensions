/**
 * pi-web — e2e test suite (extension factory level)
 *
 * Run: node --import tsx --test index.e2e.test.mjs
 *
 * Drives the extension with a mock ExtensionAPI: tool registration,
 * pi_web_fetch (single + multi URL, error paths), pi_web_read (slices),
 * session_start cache restore via pi.appendEntry.
 *
 * The SSRF guard blocks loopback by default, so the test redirects HOME to a
 * temp dir with a pi-web.json allowlist for 127.0.0.1.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import piWebExtension from "../index.ts";
import { storePage, clearPages, readSlice } from "../lib/_storage.ts";
import { createMockPi, createMockCtx } from "../../../test/harness.mjs";

// ── Local server fixture ─────────────────────────────────────────

async function startServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

const PAGE = `<!DOCTYPE html>
<html><head><title>E2E Article</title></head>
<body>
<header><nav><a href="/">Home</a></nav></header>
<article>
  <h1>E2E Article</h1>
  <p>Some fetchable content.</p>
</article>
<footer>footer</footer>
</body></html>`;

// Redirect HOME so loadConfig() picks up an allowlist for loopback
async function withHomeAllowlist(fn) {
  const originalHome = process.env.HOME;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-home-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "pi-web.json"),
    JSON.stringify({ allowRanges: ["127.0.0.1", "::1"], maxChars: 500 }),
  );
  process.env.HOME = dir;
  try {
    return await fn();
  } finally {
    process.env.HOME = originalHome;
  }
}

// ── Tool registration ─────────────────────────────────────────────

test("registers pi_web_fetch and pi_web_read tools + session_start", () => {
  const { pi, tools, handlers } = createMockPi();
  piWebExtension(pi);
  assert.ok(tools.has("pi_web_fetch"));
  assert.ok(tools.has("pi_web_read"));
  assert.ok(handlers.get("session_start")?.length);
  assert.equal(tools.get("pi_web_fetch").name, "pi_web_fetch");
  assert.equal(tools.get("pi_web_read").name, "pi_web_read");
});

// ── pi_web_fetch: error paths ─────────────────────────────────────

test("pi_web_fetch: no url → error result", async () => {
  const { pi, tools } = createMockPi();
  piWebExtension(pi);
  const result = await tools.get("pi_web_fetch").execute("id", {});
  assert.match(result.content[0].text, /Error: provide a url/);
  assert.equal(result.details.error, "no url");
});

test("pi_web_fetch: unsupported protocol → SSRF guard error", async () => {
  const { pi, tools } = createMockPi();
  piWebExtension(pi);
  const result = await tools.get("pi_web_fetch").execute("id", { url: "ftp://example.com/file" });
  assert.ok(result.details.error, "must return an error detail");
  assert.match(result.content[0].text, /Error/);
});

// ── pi_web_fetch: happy path through the tool ─────────────────────

test("pi_web_fetch: fetches a page, persists it and appends a session entry", async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  try {
    await withHomeAllowlist(async () => {
      const { pi, tools, calls } = createMockPi();
      piWebExtension(pi);
      const result = await tools.get("pi_web_fetch").execute("id", { url: `${srv.url}/page` });
      assert.ok(result.content[0].text.includes("E2E Article"), "markdown contains the title");
      assert.ok(result.content[0].text.includes("Source:"), "metadata includes source");
      assert.equal(result.details.truncated, false);
      assert.equal(result.details.successful, 1);
      // persisted for pi_web_read (stored content is the markdown body)
      const slice = readSlice(result.details.id, 0, 500);
      assert.ok(slice.text.includes("Some fetchable content."));
      // session entry appended
      assert.ok(calls.appendEntry.some(([type]) => type === "pi-web-page"));
    });
  } finally {
    await srv.close();
  }
});

test("pi_web_fetch: multiple URLs produce a multi-fetch summary", async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGE);
  });
  try {
    await withHomeAllowlist(async () => {
      const { pi, tools } = createMockPi();
      piWebExtension(pi);
      const result = await tools.get("pi_web_fetch").execute("id", { urls: [`${srv.url}/a`, `${srv.url}/b`] });
      assert.equal(result.details.urlCount, 2);
      assert.equal(result.details.successful, 2);
      assert.match(result.content[0].text, /fetched/i);
      assert.ok(result.content[0].text.includes("E2E Article"));
    });
  } finally {
    await srv.close();
  }
});

test("pi_web_fetch: single URL failure surfaces the page error", async () => {
  const srv = await startServer((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  try {
    await withHomeAllowlist(async () => {
      const { pi, tools } = createMockPi();
      piWebExtension(pi);
      const result = await tools.get("pi_web_fetch").execute("id", { url: `${srv.url}/err` });
      assert.match(result.content[0].text, /Error/);
      assert.ok(result.details.error);
    });
  } finally {
    await srv.close();
  }
});

// ── pi_web_read ───────────────────────────────────────────────────

test("pi_web_read: reads a stored page and slice hints", async () => {
  const { pi, tools } = createMockPi();
  piWebExtension(pi);
  clearPages();
  storePage({
    id: "p1",
    url: "https://example.com",
    title: "T",
    content: "x".repeat(1000),
    contentType: "text/markdown",
    fetchedAt: Date.now(),
  });
  const result = await tools.get("pi_web_read").execute("id", { id: "p1", limit: 100 });
  assert.ok(result.content[0].text.startsWith("x".repeat(100)), "first slice is exactly 100 chars");
  assert.ok(result.content[0].text.includes("pi_web_read({ id: \"p1\""), "slice hint included when truncated");
  assert.equal(result.details.end, false);
  assert.equal(result.details.totalChars, 1000);
});

test("pi_web_read: last slice marks end without hint", async () => {
  const { pi, tools } = createMockPi();
  piWebExtension(pi);
  clearPages();
  storePage({ id: "p2", url: "https://example.com", title: "T", content: "short", contentType: "text/markdown", fetchedAt: Date.now() });
  const result = await tools.get("pi_web_read").execute("id", { id: "p2", offset: 0, limit: 100 });
  assert.equal(result.details.end, true);
  assert.ok(!result.content[0].text.includes("pi_web_read({ id:"), "no hint at end");
});

test("pi_web_read: unknown id → error", async () => {
  const { pi, tools } = createMockPi();
  piWebExtension(pi);
  const result = await tools.get("pi_web_read").execute("id", { id: "nope" });
  assert.match(result.content[0].text, /Error/);
  assert.ok(result.details.error);
});

// ── session_start restore ─────────────────────────────────────────

test("session_start: restores pages from the session branch", async () => {
  const { pi, emit } = createMockPi();
  piWebExtension(pi);
  clearPages();
  const stored = { id: "restored-1", url: "https://example.com/x", title: "Restored", content: "hello from a previous session", contentType: "text/markdown", fetchedAt: Date.now() };
  const branch = [{ type: "custom", customType: "pi-web-page", data: stored }];
  const ctx = createMockCtx({ sessionManager: { getBranch: () => branch, getEntries: () => [] } });
  await emit("session_start", {}, ctx);
  const slice = readSlice("restored-1", 0, 100);
  assert.equal(slice.text, "hello from a previous session");
});
