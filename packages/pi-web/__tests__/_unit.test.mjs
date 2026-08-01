import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";

import { fetchPage, fetchPages } from "../lib/_fetch.ts";
import { storePage, getPage, readSlice, clearPages, restorePages } from "../lib/_storage.ts";
import { formatFetchResult, formatMultiFetchSummary } from "../lib/_format.ts";

// ── Test HTTP server fixtures ───────────────────────────────────────────

async function startServer(host, handler) {
  const server = http.createServer(handler);
  server.listen(0, host);
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return {
    server,
    url: `http://${hostPart}:${address.port}`,
    host,
    port: address.port,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

const ARTICLE_HTML = `<!DOCTYPE html>
<html><head><title>The Readable Title</title></head>
<body>
<header><nav><a href="/x">Home</a></nav></header>
<article>
  <h1>The Readable Title</h1>
  <p>First paragraph with meaningful content.</p>
  <h2>Section</h2>
  <p>Second paragraph here.</p>
</article>
<footer>footer stuff</footer>
</body></html>`;

const DOCS_HTML = `<!DOCTYPE html>
<html><head><title>Docs Page</title></head>
<body>
<main>
<h1>API Reference</h1>
<table>
<tr><th>Method</th><th>Path</th></tr>
<tr><td>GET</td><td>/users</td></tr>
</table>
</main>
</body></html>`;

const SPA_HTML = `<!DOCTYPE html>
<html><head><title>SPA App</title></head>
<body><div id="root"></div><script>window.__APP__ = true;</script></body></html>`;

const BARE_TEXT_HTML = `<!DOCTYPE html>
<html><body>Some direct text content without any markup.</body></html>`;

const ALLOW_LOCALHOST = ["127.0.0.1", "::1"];
const ALLOW_BOTH = ["127.0.0.1", "::1"];

// ── fetchPage: HTML → markdown ──────────────────────────────────────────

test("fetchPage extracts readable markdown from an article page", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ARTICLE_HTML);
  });
  try {
    const page = await fetchPage(`${srv.url}/article`, { allowRanges: ALLOW_LOCALHOST });
    assert.equal(page.error, null);
    // Readability promotes the h1 to the article title (consumed from content)
    assert.equal(page.title, "The Readable Title");
    assert.match(page.content, /First paragraph with meaningful content\./);
    assert.match(page.content, /## Section/);
    assert.match(page.content, /Second paragraph here\./);
    // nav/footer noise is dropped by Readability
    assert.ok(!page.content.includes("footer stuff"));
  } finally {
    await srv.close();
  }
});

test("fetchPage raw mode keeps table content", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DOCS_HTML);
  });
  try {
    const page = await fetchPage(`${srv.url}/docs`, { allowRanges: ALLOW_LOCALHOST, raw: true });
    assert.equal(page.error, null);
    assert.match(page.content, /GET/);
    assert.match(page.content, /\/users/);
  } finally {
    await srv.close();
  }
});

test("fetchPage returns plain text for text/plain responses", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("plain text content");
  });
  try {
    const page = await fetchPage(`${srv.url}/raw.txt`, { allowRanges: ALLOW_LOCALHOST });
    assert.equal(page.error, null);
    assert.equal(page.content, "plain text content");
  } finally {
    await srv.close();
  }
});

test("fetchPage reports unsupported content types", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end("%PDF-1.4 fake");
  });
  try {
    const page = await fetchPage(`${srv.url}/doc.pdf`, { allowRanges: ALLOW_LOCALHOST });
    assert.match(page.error ?? "", /Unsupported content type/);
    assert.equal(page.content, "");
  } finally {
    await srv.close();
  }
});

test("fetchPage aborts oversized responses", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<html><body>" + "x".repeat(100_000) + "</body></html>");
  });
  try {
    const page = await fetchPage(`${srv.url}/big`, {
      allowRanges: ALLOW_LOCALHOST,
      maxResponseBytes: 10_000,
    });
    assert.match(page.error ?? "", /too large/i);
  } finally {
    await srv.close();
  }
});

test("fetchPage times out on slow responses", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("late");
    }, 1500);
  });
  try {
    const page = await fetchPage(`${srv.url}/slow`, {
      allowRanges: ALLOW_LOCALHOST,
      timeoutMs: 200,
    });
    assert.match(page.error ?? "", /timed out/i);
  } finally {
    await srv.close();
  }
});

test("fetchPage rejects URLs that are not http(s)", async () => {
  const page = await fetchPage("ftp://example.com/file", { allowRanges: ALLOW_LOCALHOST });
  assert.match(page.error ?? "", /http/i);
  const page2 = await fetchPage("not a url");
  assert.match(page2.error ?? "", /http/i);
});

// ── SSRF protection ──────────────────────────────────────────────────────

test("fetchPage blocks private/loopback addresses by default", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("secret");
  });
  try {
    const page = await fetchPage(`${srv.url}/`);
    assert.match(page.error ?? "", /blocked/i);
    assert.equal(page.content, "");
  } finally {
    await srv.close();
  }
});

test("fetchPage allows loopback when allowRanges is configured", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("secret");
  });
  try {
    const page = await fetchPage(`${srv.url}/`, { allowRanges: ALLOW_LOCALHOST });
    assert.equal(page.error, null);
    assert.equal(page.content, "secret");
  } finally {
    await srv.close();
  }
});

test("fetchPage validates SSRF on every redirect hop", async () => {
  // Second loopback: IPv6 ::1 (127.0.0.2 is not bound on macOS by default)
  const target = await startServer("::1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("target body");
  });
  const source = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(302, { Location: `${target.url}/final` });
    res.end();
  });
  try {
    // Hop 2 (::1) is NOT allowlisted → blocked
    const blocked = await fetchPage(`${source.url}/start`, { allowRanges: ["127.0.0.1"] });
    assert.match(blocked.error ?? "", /blocked/i);

    // Both hops allowlisted → follows and reports the final URL
    const ok = await fetchPage(`${source.url}/start`, { allowRanges: ALLOW_BOTH });
    assert.equal(ok.error, null);
    assert.equal(ok.content, "target body");
    assert.equal(ok.url, `${target.url}/final`);
  } finally {
    await source.close();
    await target.close();
  }
});

// ── Low-quality / JS-rendered fallback ───────────────────────────────────

test("fetchPage extracts bare-text pages without markup", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(BARE_TEXT_HTML);
  });
  try {
    const page = await fetchPage(`${srv.url}/bare`, { allowRanges: ALLOW_LOCALHOST });
    assert.equal(page.error, null);
    assert.match(page.content, /Some direct text content without any markup\./);
  } finally {
    await srv.close();
  }
});

test("fetchPage marks JS-rendered shells as low-quality without crashing", async () => {
  const srv = await startServer("127.0.0.1", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SPA_HTML);
  });
  try {
    const page = await fetchPage(`${srv.url}/spa`, { allowRanges: ALLOW_LOCALHOST });
    assert.equal(page.error, null);
    assert.equal(page.lowQuality, true);
  } finally {
    await srv.close();
  }
});

// ── fetchPages: parallel with concurrency cap ────────────────────────────

test("fetchPages respects the concurrency limit", async () => {
  let active = 0;
  let maxActive = 0;
  const srv = await startServer("127.0.0.1", (_req, res) => {
    active++;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active--;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    }, 40);
  });
  try {
    const urls = Array.from({ length: 6 }, (_, i) => `${srv.url}/${i}`);
    const pages = await fetchPages(urls, { allowRanges: ALLOW_LOCALHOST, concurrency: 2 });
    assert.equal(pages.length, 6);
    assert.ok(pages.every((p) => p.error === null));
    assert.ok(maxActive <= 2, `maxActive was ${maxActive}`);
  } finally {
    await srv.close();
  }
});

// ── storage: slices + session restore ────────────────────────────────────

test("readSlice returns bounded slices and reports the end", () => {
  clearPages();
  storePage({ id: "abc", url: "https://example.com/x", title: "T", content: "0123456789", contentType: "text/markdown", fetchedAt: 1 });

  const first = readSlice("abc", 0, 4);
  assert.equal(first.text, "0123");
  assert.equal(first.nextOffset, 4);
  assert.equal(first.totalChars, 10);
  assert.equal(first.end, false);

  const last = readSlice("abc", 8, 10);
  assert.equal(last.text, "89");
  assert.equal(last.end, true);

  const pastEnd = readSlice("abc", 10, 5);
  assert.equal(pastEnd.text, "");
  assert.equal(pastEnd.end, true);

  assert.equal(readSlice("abc", 11, 5).error, "offset out of range");
  assert.equal(readSlice("unknown", 0, 5).error, "unknown id");
});

test("restorePages rebuilds the cache from session entries", () => {
  clearPages();
  restorePages([
    { customType: "pi-web-page", data: { id: "s1", url: "https://a.example", title: "A", content: "hello world", contentType: "text/markdown", fetchedAt: Date.now() - 1000 } },
    { customType: "pi-web-page", data: { id: "s2", url: "https://b.example", title: "B", content: 42 } }, // invalid
    { customType: "other", data: { id: "s3" } }, // wrong customType
  ]);
  assert.equal(getPage("s1")?.title, "A");
  assert.equal(getPage("s1")?.content, "hello world");
  assert.equal(getPage("s2"), null);
  assert.equal(getPage("s3"), null);
});

// ── format: context-ready output ─────────────────────────────────────────

test("formatFetchResult includes header and slice hint when truncated", () => {
  const page = {
    id: "p1",
    url: "https://example.com/long",
    title: "Long Page",
    content: "A".repeat(1000),
    contentType: "text/markdown",
    error: null,
    lowQuality: false,
    fetchedAt: 0,
    bytesRead: 1000,
  };
  const { text, truncated, totalChars } = formatFetchResult(page, { maxChars: 100 });
  assert.equal(truncated, true);
  assert.equal(totalChars, 1000);
  assert.match(text, /^# Long Page/m);
  assert.match(text, /Source: https:\/\/example\.com\/long/);
  assert.match(text, /pi_web_read\(\{ id: "p1", offset: 100 \}\)/);
  assert.ok(text.length < 400, "truncated output stays small");
});

test("formatFetchResult does not truncate short pages", () => {
  const page = {
    id: "p2",
    url: "https://example.com/short",
    title: "Short",
    content: "tiny",
    contentType: "text/markdown",
    error: null,
    lowQuality: false,
    fetchedAt: 0,
    bytesRead: 4,
  };
  const { text, truncated } = formatFetchResult(page, { maxChars: 100 });
  assert.equal(truncated, false);
  assert.match(text, /tiny/);
  assert.ok(!text.includes("pi_web_read"));
});

test("formatMultiFetchSummary lists pages with char counts", () => {
  const pages = [
    { id: "a", url: "https://a.example", title: "Page A", content: "x".repeat(50), contentType: "text/markdown", error: null, lowQuality: false, fetchedAt: 0, bytesRead: 50 },
    { id: "b", url: "https://b.example", title: "Page B", content: "y".repeat(30), contentType: "text/markdown", error: null, lowQuality: false, fetchedAt: 0, bytesRead: 30 },
    { id: "c", url: "https://c.example", title: "Page C", content: "", contentType: "text/html", error: "Nope", lowQuality: false, fetchedAt: 0, bytesRead: 0 },
  ];
  const text = formatMultiFetchSummary(pages, 80);
  assert.match(text, /Page A \(50 chars\)/);
  assert.match(text, /Page B \(30 chars\)/);
  assert.match(text, /Page C: Error - Nope/);
  assert.match(text, /pi_web_read/);
});
