/**
 * Context-ready output formatting: a Markdown document with a small header
 * (title, source URL, fetch timestamp, char count) and a slice hint when the
 * page is truncated, so the LLM knows exactly how to pull the rest.
 */

export interface FormatPage {
  id: string;
  url: string;
  title: string;
  content: string;
  contentType: string;
  error: string | null;
  lowQuality: boolean;
  fetchedAt: number;
  bytesRead: number;
}

export interface FormatResult {
  text: string;
  truncated: boolean;
  totalChars: number;
}

export function formatFetchResult(page: FormatPage, options: { maxChars: number }): FormatResult {
  const totalChars = page.content.length;
  const truncated = totalChars > options.maxChars;

  let text = `# ${page.title || page.url}\n\n`;
  text += `> Source: ${page.url} · Fetched: ${new Date(page.fetchedAt).toISOString()} · ${totalChars} chars`;
  if (page.lowQuality) {
    text += " · ⚠ low-quality extraction (page may be JS-rendered)";
  }
  text += "\n\n---\n\n";

  if (truncated) {
    text += page.content.slice(0, options.maxChars);
    text += `\n\n---\n[Showing ${options.maxChars} of ${totalChars} chars. Use pi_web_read({ id: "${page.id}", offset: ${options.maxChars} }) to read the next slice.]`;
  } else {
    text += page.content;
  }

  return { text, truncated, totalChars };
}

export function formatMultiFetchSummary(pages: FormatPage[], totalChars: number): string {
  let text = "## Fetched URLs\n\n";
  for (const page of pages) {
    if (page.error) {
      text += `- ${page.title || page.url}: Error - ${page.error}\n`;
    } else {
      text += `- ${page.title || page.url} (${page.content.length} chars)\n`;
    }
  }
  text += `\n---\nEach page is stored and can be read in slices with pi_web_read({ id: "<id>", offset: 0 }).`;
  return text;
}
