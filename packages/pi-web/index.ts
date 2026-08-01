/**
 * @pixu1980/pi-web — scrape any webpage into clean, context-ready Markdown.
 *
 * Inspired by pi-web-access (https://github.com/nicobailon/pi-web-access):
 * same extraction stack (Readability + Turndown + linkedom), but focused on
 * the fetching part only. The search-result "curator" browser UI of
 * pi-web-access is intentionally left out — a scraper is synchronous and
 * deterministic, there is nothing to curate.
 *
 * Tools:
 *  - pi_web_fetch: URL(s) → Markdown with title/source metadata, truncation
 *    and slice hints.
 *  - pi_web_read: pull further bounded slices of an already-fetched page.
 */
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchPages, type FetchedPage } from "./fetch.ts";
import { storePage, readSlice, restorePages, type StoredPage } from "./storage.ts";
import { formatFetchResult, formatMultiFetchSummary } from "./format.ts";
import { loadConfig } from "./config.ts";

const ENTRY_TYPE = "pi-web-page";

export default function piWebExtension(pi: ExtensionAPI) {
  const config = loadConfig();

  // Rebuild the page cache from the current session branch on reload/restore.
  pi.on("session_start", (_event, ctx) => {
    const entries: unknown[] = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
        entries.push(entry);
      }
    }
    restorePages(entries);
  });

  function persist(page: FetchedPage): void {
    const stored: StoredPage = {
      id: page.id,
      url: page.url,
      title: page.title,
      content: page.content,
      contentType: page.contentType,
      fetchedAt: page.fetchedAt,
    };
    storePage(stored);
    pi.appendEntry(ENTRY_TYPE, stored);
  }

  pi.registerTool({
    name: "pi_web_fetch",
    label: "Fetch Page (Markdown)",
    description:
      "Fetch one or more URLs and convert them into clean, context-ready Markdown. The output is a Markdown document with the page title, source URL, fetch timestamp and char count. Large pages are truncated and the rest can be read with pi_web_read. Private/loopback addresses are blocked by default (SSRF guard); configure ~/.pi/pi-web.json allowRanges to permit local development servers.",
    promptSnippet: "Fetch URL(s) as Markdown and add the content to context",
    promptGuidelines: [
      "Use pi_web_fetch when the user wants a webpage's content added to the conversation context.",
      "Use pi_web_fetch(raw: true) for documentation/API pages where Readability strips tables or code blocks.",
      "Use pi_web_read to retrieve further slices of a page returned by pi_web_fetch.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(
        Type.Array(Type.String(), {
          description: "Multiple URLs to fetch in parallel (concurrency-capped)",
        }),
      ),
      raw: Type.Optional(
        Type.Boolean({
          description:
            "Skip Readability and convert the whole page body (keeps tables and code blocks). Default false.",
        }),
      ),
      maxChars: Type.Optional(
        Type.Integer({ description: "Max characters of Markdown to return inline (default from config, 12000)." }),
      ),
      timeoutMs: Type.Optional(Type.Integer({ description: "Per-request timeout in milliseconds (default 30000)." })),
    }),
    async execute(_toolCallId, params, _signal, onUpdate): Promise<AgentToolResult<Record<string, unknown>>> {
      const urlList = params.urls?.length ? params.urls : params.url ? [params.url] : [];
      if (urlList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: provide a url or a urls array." }],
          details: { error: "no url" },
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
        details: { phase: "fetch", progress: 0 },
      });

      const pages = await fetchPages(urlList, {
        timeoutMs: params.timeoutMs ?? config.timeoutMs,
        raw: params.raw,
        allowRanges: config.allowRanges,
        maxResponseBytes: config.maxResponseBytes,
        concurrency: config.concurrency,
      });

      for (const page of pages) persist(page);

      const successful = pages.filter((page) => !page.error).length;

      if (urlList.length === 1) {
        const page = pages[0];
        if (page.error) {
          return {
            content: [{ type: "text", text: `Error: ${page.error}` }],
            details: { url: page.url, error: page.error, id: page.id },
          };
        }
        const maxChars = params.maxChars ?? config.maxChars;
        const { text, truncated, totalChars } = formatFetchResult(page, { maxChars });
        return {
          content: [{ type: "text", text }],
          details: { id: page.id, url: page.url, title: page.title, totalChars, truncated, successful: 1 },
        };
      }

      const totalChars = pages.reduce((sum, page) => sum + page.content.length, 0);
      return {
        content: [{ type: "text", text: formatMultiFetchSummary(pages, totalChars) }],
        details: { ids: pages.map((page) => page.id), successful, totalChars, urlCount: urlList.length },
      };
    },
  });

  pi.registerTool({
    name: "pi_web_read",
    label: "Read Page Slice",
    description:
      "Read a bounded slice of a page previously fetched with pi_web_fetch. Pages are cached in memory and restored from the session on reload. Pass the id from a pi_web_fetch result plus an offset to continue exactly where the previous slice ended.",
    promptSnippet: "Retrieve further slices of a page fetched with pi_web_fetch",
    parameters: Type.Object({
      id: Type.String({ description: "Page id from a pi_web_fetch result" }),
      offset: Type.Optional(Type.Integer({ description: "Character offset to start from (default 0)" })),
      limit: Type.Optional(Type.Integer({ description: "Max characters to return (default from config, 12000)" })),
    }),
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const slice = readSlice(params.id, params.offset ?? 0, params.limit ?? config.maxChars);
      if (slice.error) {
        return {
          content: [{ type: "text", text: `Error: ${slice.error}` }],
          details: { error: slice.error },
        };
      }
      let text = slice.text;
      if (!slice.end) {
        text += `\n\n---\n[${slice.nextOffset} of ${slice.totalChars} chars. Use pi_web_read({ id: "${params.id}", offset: ${slice.nextOffset} }) to continue.]`;
      }
      return {
        content: [{ type: "text", text }],
        details: {
          id: params.id,
          offset: slice.offset,
          nextOffset: slice.nextOffset,
          totalChars: slice.totalChars,
          end: slice.end,
        },
      };
    },
  });
}
