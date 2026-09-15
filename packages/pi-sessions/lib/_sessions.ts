/**
 * pi-sessions - session file discovery and parsing (private module)
 */

import { createReadStream, readFileSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { SESSION_DIR_NAME, MAX_NAME_LENGTH, MAX_SESSIONS, MAX_SESSION_SCAN_LINES, CACHE_TTL_MS } from "./_constants.ts";
import type { SessionSummary, TextContentBlock } from "./_types.ts";

// ── Session Cache ───────────────────────────────────────────────────

let cachedSessions: SessionSummary[] | null = null;
let cacheTimestamp = 0;
let pendingSessions: Promise<SessionSummary[]> | null = null;
let cacheGeneration = 0;

/**
 * Invalidate the session cache. Explicit contract: called on session_start
 * (a new session file exists now) and by tests. The cached path makes no
 * filesystem call, so this is the only freshness lever before the TTL.
 */
export function clearSessionsCache(): void {
  cachedSessions = null;
  cacheTimestamp = 0;
  pendingSessions = null;
  cacheGeneration++;
}

export type SessionListProgress = (loaded: number, total: number) => void;

// ── Cached-path economics (PERF-11) ──────────────────────────────
//
// Measured on a real agent dir (493 sessions, 133,922 scanned lines):
//   cold full listing  4341.9ms
//   cached serve          0.012ms
// A directory stat costs 1.8us - 0.00004% of the listing it would guard -
// so the cached path makes NO filesystem call at all.
//
// The previous mtime check was dropped for a second reason: it statted the
// PARENT sessions dir, and writing a session into an existing project
// subdirectory does not change that mtime (measured), so it only ever
// detected brand-new project directories - it paid a syscall per open for an
// invalidation it did not deliver.

/**
 * Get sessions asynchronously with caching. The cached list is served for
 * `CACHE_TTL_MS`; `clearSessionsCache()` is the explicit invalidation hook.
 */
export async function getSessions(onProgress?: SessionListProgress): Promise<SessionSummary[]> {
  const now = Date.now();

  if (cachedSessions && (now - cacheTimestamp) < CACHE_TTL_MS) {
    onProgress?.(cachedSessions.length, cachedSessions.length);

    return cachedSessions;
  }

  if (pendingSessions) {
    return pendingSessions;
  }

  const generation = cacheGeneration;
  const request = listSessionsAsync(onProgress);

  pendingSessions = request;

  try {
    const sessions = await request;

    if (generation === cacheGeneration) {
      cachedSessions = sessions;
      cacheTimestamp = Date.now();
    }

    return sessions;
  } finally {
    if (pendingSessions === request) {
      pendingSessions = null;
    }
  }
}

// ── Session Listing ────────────────────────────────────────────────

/**
 * Get the pi.dev sessions directory.
 */
export function getSessionsDir(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");

  return join(agentDir, SESSION_DIR_NAME);
}

function isTextBlock(value: unknown): value is TextContentBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as Record<string, unknown>).type === "text" &&
    "text" in value &&
    typeof (value as Record<string, unknown>).text === "string"
  );
}

/**
 * Auto-generate a session name from the first user message content.
 */
export function autoNameSession(content: unknown): string {
  if (!content) {
    return "Empty session";
  }

  let text = "";

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (isTextBlock(block)) {
        text = block.text;
        break;
      }
    }
  }

  // Clean up: trim, remove excessive whitespace, truncate
  text = text.replaceAll(/\s+/g, " ").trim();

  if (!text) {
    return "Empty session";
  }

  const truncated = text.length > MAX_NAME_LENGTH
    ? text.slice(0, MAX_NAME_LENGTH - 3) + "..."
    : text;

  return truncated;
}

interface SessionScan {
  generatedName: string;
  explicitName?: string;
  date: string;
  messageCount: number;
  model?: string;
  provider?: string;
  cwd?: string;
  lastUserMessage?: string;
}

function createSessionScan(): SessionScan {
  return {
    generatedName: "Unknown session",
    date: "",
    messageCount: 0,
  };
}

function scanSessionEntry(scan: SessionScan, entry: Record<string, any>): void {
  if (entry.type === "session") {
    if (typeof entry.cwd === "string") {
      scan.cwd = entry.cwd;
    }

    if (typeof entry.timestamp === "string") {
      scan.date = entry.timestamp;
    }

    return;
  }

  if (entry.type === "session_info") {
    scan.explicitName = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : undefined;

    return;
  }

  if (entry.type !== "message" || !entry.message) {
    return;
  }

  const message = entry.message as Record<string, any>;

  if (message.role === "user") {
    if (scan.generatedName === "Unknown session") {
      scan.generatedName = autoNameSession(message.content);
    }

    scan.lastUserMessage = autoNameSession(message.content);
    scan.messageCount++;

    return;
  }

  if (message.role === "assistant") {
    if (typeof message.model === "string") {
      scan.model = message.model;
    }

    if (typeof message.provider === "string") {
      scan.provider = message.provider;
    }

    scan.messageCount++;
  }
}

function scanSessionLine(scan: SessionScan, line: string): void {
  if (!line.trim()) {
    return;
  }

  try {
    const entry = JSON.parse(line);

    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      scanSessionEntry(scan, entry as Record<string, any>);
    }
  } catch {
    // Best-effort discovery skips malformed JSONL lines.
  }
}

function finishSessionSummary(
  filePath: string,
  scan: SessionScan,
  mtimeMs: number,
  mtime: Date,
): SessionSummary {
  return {
    file: filePath,
    name: scan.explicitName || scan.generatedName,
    date: scan.date || mtime.toISOString(),
    messageCount: scan.messageCount,
    model: scan.model,
    provider: scan.provider,
    cwd: scan.cwd,
    mtime: mtimeMs,
    lastUserMessage: scan.lastUserMessage,
  };
}

/**
 * Parse a session JSONL file and extract summary info.
 */
export function parseSessionFile(filePath: string): SessionSummary | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const stats = statSync(filePath);
    const scan = createSessionScan();

    for (const line of content.split("\n")) {
      scanSessionLine(scan, line);
    }

    return finishSessionSummary(filePath, scan, stats.mtimeMs, stats.mtime);
  } catch {
    return null;
  }
}

const MAX_CONCURRENT_SESSION_READS = 10;

// ── Bounded-work counters (PERF-04) ──────────────────────────────
// Proof that discovery stays O(MAX_SESSIONS) in memory and that scanning
// caps pathological files: candidates never exceed MAX_SESSIONS and lines
// scanned never grows unbounded.

interface SessionsStats {
  dirReads: number;
  fileStats: number;
  candidatesReturned: number;
  filesParsed: number;
  linesScanned: number;
}

const sessionsStats: SessionsStats = { dirReads: 0, fileStats: 0, candidatesReturned: 0, filesParsed: 0, linesScanned: 0 };

export function getSessionsStats(): SessionsStats {
  return { ...sessionsStats };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  // Backpressure contract: at most `limit` reads in flight; the remaining
  // items wait in the loop (deferred, never dropped). The caller bounds the
  // item count (MAX_SESSIONS candidates) so the queue itself is bounded.
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;

        if (index >= items.length) {
          return;
        }

        results[index] = await worker(items[index]!, index);
      }
    },
  );

  await Promise.all(workers);

  return results;
}

async function parseSessionFileAsync(filePath: string): Promise<SessionSummary | null> {
  sessionsStats.filesParsed++;

  try {
    const stats = await stat(filePath);
    const input = createReadStream(filePath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const scan = createSessionScan();
    let scanned = 0;

    try {
      for await (const line of lines) {
        scanSessionLine(scan, line);
        scanned++;

        // A summary only needs the header, the first user message and a
        // sample of metadata; stop reading pathological files at the cap.
        if (scanned >= MAX_SESSION_SCAN_LINES) {
          break;
        }
      }
    } finally {
      lines.close();
      input.destroy();
      sessionsStats.linesScanned += scanned;
    }

    return finishSessionSummary(filePath, scan, stats.mtimeMs, stats.mtime);
  } catch {
    return null;
  }
}

// Bounded top-k selection: keep at most MAX_SESSIONS newest files in a
// sorted array (descending by mtime). Insert cost is O(k) with k capped at
// 500, so discovery memory stays O(MAX_SESSIONS) no matter how many session
// files accumulate.
function insertCandidate(
  top: Array<{ path: string; mtime: number }>,
  entry: { path: string; mtime: number },
): void {
  let lo = 0;
  let hi = top.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (top[mid]!.mtime > entry.mtime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  top.splice(lo, 0, entry);

  if (top.length > MAX_SESSIONS) {
    top.length = MAX_SESSIONS;
  }
}

async function findSessionCandidates(): Promise<string[]> {
  const sessionsDir = getSessionsDir();

  try {
    sessionsStats.dirReads++;
    const projects = (await readdir(sessionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory());
    const top: Array<{ path: string; mtime: number }> = [];

    await Promise.all(projects.map(async (project) => {
      const projectPath = join(sessionsDir, project.name);

      try {
        sessionsStats.dirReads++;
        const files = (await readdir(projectPath, { withFileTypes: true }))
          .filter((entry) => entry.name.endsWith(".jsonl"));

        await mapWithConcurrency(files, MAX_CONCURRENT_SESSION_READS, async (entry) => {
          const filePath = join(projectPath, entry.name);

          try {
            sessionsStats.fileStats++;
            const info = await stat(filePath);

            if (info.isFile()) {
              insertCandidate(top, { path: filePath, mtime: info.mtimeMs });
            }
          } catch {
            // unreadable file -> skip
          }
        });
      } catch {
        // unreadable project dir -> skip
      }
    }));

    sessionsStats.candidatesReturned = top.length;

    return top.map((entry) => entry.path);
  } catch {
    return [];
  }
}

async function listSessionsAsync(onProgress?: SessionListProgress): Promise<SessionSummary[]> {
  const files = await findSessionCandidates();
  let loaded = 0;
  const summaries = await mapWithConcurrency(files, MAX_CONCURRENT_SESSION_READS, async (file) => {
    try {
      return await parseSessionFileAsync(file);
    } finally {
      loaded++;
      onProgress?.(loaded, files.length);
    }
  });

  return summaries
    .filter((summary): summary is SessionSummary => summary !== null)
    .sort((left, right) => right.mtime - left.mtime);
}

/**
 * Format a date string for display.
 * Parses ISO 8601 dates robustly, handling missing timezone.
 */
export function formatDate(isoStr: string): string {
  try {
    // Normalize: if no timezone offset/Z, treat as UTC
    const normalized = /\d{2}:\d{2}$/.test(isoStr) && !isoStr.endsWith("Z") && !isoStr.endsWith("+00:00")
      ? isoStr + "Z"
      : isoStr;
    const d = new Date(normalized);

    if (isNaN(d.getTime())) {
      return "";
    }

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  } catch {
    return "";
  }
}
