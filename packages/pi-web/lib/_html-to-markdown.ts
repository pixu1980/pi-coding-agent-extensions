/**
 * HTML → Markdown conversion, the same stack pi-web-access popularized:
 * Readability (article extraction) + Turndown (HTML → Markdown), with
 * linkedom providing a DOM in Node without a browser.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export interface HtmlToMarkdownResult {
  title: string;
  markdown: string;
  /** true when Readability found no article and we fell back to the whole body */
  lowQuality: boolean;
}

export function htmlToMarkdown(html: string, raw: boolean): HtmlToMarkdownResult {
  const { document } = parseHTML(html);
  const documentTitle = document.title?.trim() ?? "";

  if (raw) {
    // Keep everything: tables, code blocks, nav - whole <body>.
    const body = document.body;
    const markdown = body ? turndown.turndown(body.innerHTML) : "";
    return { title: documentTitle, markdown, lowQuality: true };
  }

  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();

  if (!article || typeof article.content !== "string" || article.content.length === 0) {
    // No article found (SPA shell, bare text, exotic markup) - fall back to
    // the whole body so we never return nothing, but flag the low quality.
    const body = document.body;
    const fallback = body ? turndown.turndown(body.innerHTML) : "";
    return { title: documentTitle, markdown: fallback, lowQuality: true };
  }

  const markdown = turndown.turndown(article.content);
  return { title: article.title || documentTitle, markdown, lowQuality: false };
}
