/**
 * In-memory cache of fetched pages plus bounded-slice reads, so large pages
 * can be pulled into context a chunk at a time. Restored from the session on
 * reload (see index.ts), mirroring how pi-web-access keeps fetch results
 * retrievable via responseId.
 */
export interface StoredPage {
  id: string;
  url: string;
  title: string;
  content: string;
  contentType: string;
  fetchedAt: number;
}

export interface SliceResult {
  text: string;
  offset: number;
  nextOffset: number;
  totalChars: number;
  end: boolean;
  error?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const pages = new Map<string, StoredPage>();

export function storePage(page: StoredPage): void {
  pages.set(page.id, page);
}

export function getPage(id: string): StoredPage | null {
  return pages.get(id) ?? null;
}

export function clearPages(): void {
  pages.clear();
}

export function readSlice(id: string, offset: number, limit: number): SliceResult {
  const page = pages.get(id);
  if (!page) {
    return { text: "", offset, nextOffset: offset, totalChars: 0, end: true, error: "unknown id" };
  }
  const total = page.content.length;
  if (offset > total) {
    return {
      text: "",
      offset,
      nextOffset: offset,
      totalChars: total,
      end: true,
      error: "offset out of range",
    };
  }
  const text = page.content.slice(offset, offset + limit);
  const nextOffset = offset + text.length;
  return { text, offset, nextOffset, totalChars: total, end: nextOffset >= total };
}

function isValidStoredPage(data: unknown): data is StoredPage {
  if (!data || typeof data !== "object") return false;
  const page = data as Record<string, unknown>;
  return (
    typeof page.id === "string" &&
    page.id.length > 0 &&
    typeof page.url === "string" &&
    typeof page.title === "string" &&
    typeof page.content === "string" &&
    typeof page.contentType === "string" &&
    typeof page.fetchedAt === "number"
  );
}

/**
 * Rebuilds the cache from session entries shaped like
 * `{ customType: "pi-web-page", data: StoredPage }`.
 */
export function restorePages(entries: unknown[]): void {
  const now = Date.now();
  for (const entry of entries) {
    const candidate = entry as { customType?: string; data?: unknown } | null;
    if (!candidate || candidate.customType !== "pi-web-page") continue;
    if (isValidStoredPage(candidate.data) && now - candidate.data.fetchedAt < CACHE_TTL_MS) {
      pages.set(candidate.data.id, candidate.data);
    }
  }
}
