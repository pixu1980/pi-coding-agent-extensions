/**
 * Core fetch pipeline: URL → validated → fetched (with timeout, byte cap,
 * manual redirects re-validated per hop) → Markdown (or plain text).
 */
import { generateId, Semaphore } from "./_utils.ts";
import { validateTargetHost } from "./ssrf.ts";
import { htmlToMarkdown } from "./html-to-markdown.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_USER_AGENT = "pi-web/0.1.0 (+https://github.com/pixu1980/pi-coding-agent-extensions)";

export interface FetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /** true = skip Readability, convert the whole page body (keeps tables/code) */
  raw?: boolean;
  /** SSRF allowlist: CIDR or literal IPs (e.g. ["127.0.0.1", "::1"]) */
  allowRanges?: string[];
  userAgent?: string;
}

export interface FetchedPage {
  id: string;
  /** final URL after redirects */
  url: string;
  title: string;
  /** Markdown (HTML pages) or raw text (text/* responses) */
  content: string;
  contentType: string;
  error: string | null;
  /** true when Readability fell back to the whole body */
  lowQuality: boolean;
  fetchedAt: number;
  bytesRead: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const message = errorMessage(err).toLowerCase();
  return message.includes("abort") || message.includes("timeout");
}

function errPage(id: string, url: string, error: string, fetchedAt: number): FetchedPage {
  return { id, url, title: "", content: "", contentType: "", error, lowQuality: false, fetchedAt, bytesRead: 0 };
}

function extractTextTitle(text: string, url: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine && firstLine.length < 120) return firstLine;
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.hostname;
  } catch {
    return url;
  }
}

function decoderFor(contentTypeHeader: string | null): TextDecoder {
  const match = /charset=([^;]+)/i.exec(contentTypeHeader ?? "");
  const charset = match?.[1]?.trim().toLowerCase() ?? "";
  const candidates: Record<string, string> = {
    "utf-8": "utf-8",
    utf8: "utf-8",
    "us-ascii": "utf-8",
    ascii: "utf-8",
    latin1: "latin1",
    "iso-8859-1": "latin1",
    "windows-1252": "latin1",
    "utf-16": "utf-16le",
    "utf-16le": "utf-16le",
  };
  const name = candidates[charset];
  if (!name) return new TextDecoder();
  try {
    return new TextDecoder(name);
  } catch {
    return new TextDecoder();
  }
}

async function readBodyCapped(res: Response, maxBytes: number, contentTypeHeader: string | null): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const decoder = decoderFor(contentTypeHeader);
  return decoder.decode(Buffer.concat(chunks));
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // nothing to drain
  }
}

export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowRanges = options.allowRanges ?? [];
  const raw = options.raw ?? false;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchedAt = Date.now();
  const id = generateId();

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return errPage(id, currentUrl, "Invalid URL: must be an absolute http(s) URL", fetchedAt);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return errPage(id, currentUrl, "Unsupported protocol: only http(s) URLs can be fetched", fetchedAt);
    }

    // Node's URL.hostname keeps IPv6 brackets ([::1]) — strip them before validation.
    const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
    const validation = await validateTargetHost(hostname, allowRanges);
    if (validation.blocked) {
      return errPage(id, currentUrl, validation.reason ?? "Address blocked", fetchedAt);
    }

    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        res = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.8,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.9",
          },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const reason = isAbortError(err)
        ? `Request timed out after ${timeoutMs}ms`
        : `Network error: ${errorMessage(err)}`;
      return errPage(id, currentUrl, reason, fetchedAt);
    }

    const status = res.status;

    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = res.headers.get("location");
      await drain(res);
      if (!location) {
        return errPage(id, currentUrl, `Redirect (${status}) without Location header`, fetchedAt);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (status >= 400) {
      await drain(res);
      return errPage(id, currentUrl, `HTTP ${status} ${res.statusText}`, fetchedAt);
    }

    const contentTypeHeader = res.headers.get("content-type");
    const contentType = (contentTypeHeader ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
    const isText =
      contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType === "application/xml" ||
      contentType === "application/javascript" ||
      contentType === "application/x-javascript";

    if (!isHtml && !isText) {
      await drain(res);
      return errPage(id, currentUrl, `Unsupported content type: ${contentType}`, fetchedAt);
    }

    let body: string;
    try {
      body = await readBodyCapped(res, maxResponseBytes, contentTypeHeader);
    } catch (err) {
      const reason = isAbortError(err)
        ? `Request timed out after ${timeoutMs}ms`
        : errorMessage(err).toLowerCase().includes("too large")
          ? `Response too large (exceeds ${maxResponseBytes} bytes limit)`
          : `Read error: ${errorMessage(err)}`;
      return errPage(id, currentUrl, reason, fetchedAt);
    }

    const bytesRead = Buffer.byteLength(body);
    let title = "";
    let content = body;
    let lowQuality = false;

    if (isHtml) {
      const result = htmlToMarkdown(body, raw);
      title = result.title;
      content = result.markdown;
      lowQuality = result.lowQuality;
    } else {
      title = extractTextTitle(body, currentUrl);
    }

    return { id, url: currentUrl, title, content, contentType, error: null, lowQuality, fetchedAt, bytesRead };
  }

  return errPage(id, currentUrl, `Too many redirects (max ${maxRedirects})`, fetchedAt);
}

export async function fetchPages(
  urls: string[],
  options: FetchOptions & { concurrency?: number } = {},
): Promise<FetchedPage[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const semaphore = new Semaphore(concurrency);
  return Promise.all(urls.map((url) => semaphore.run(() => fetchPage(url, options))));
}
