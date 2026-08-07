/**
 * pi-sessions - session file discovery and parsing (private module)
 */

import { createReadStream, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { SESSION_DIR_NAME, MAX_NAME_LENGTH, MAX_SESSIONS, CACHE_TTL_MS } from "./_constants.ts";
import type { SessionSummary, TextContentBlock } from "./_types.ts";

// ── Session Cache ───────────────────────────────────────────────────

let cachedSessions: SessionSummary[] | null = null;
let cacheTimestamp = 0;
let cacheDirMtime = 0;
let pendingSessions: Promise<SessionSummary[]> | null = null;
let cacheGeneration = 0;

/**
 * Invalidate the session cache when the sessions directory changes.
 */
function getSessionsDirMtime(): number {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return 0;
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

export type SessionListProgress = (loaded: number, total: number) => void;

/**
 * Get sessions asynchronously with caching. Cache is invalidated when the
 * sessions directory changes or its TTL expires.
 */
export async function getSessions(onProgress?: SessionListProgress): Promise<SessionSummary[]> {
  const now = Date.now();
  const currentMtime = getSessionsDirMtime();

  if (cachedSessions && (now - cacheTimestamp) < CACHE_TTL_MS && currentMtime === cacheDirMtime) {
    onProgress?.(cachedSessions.length, cachedSessions.length);
    return cachedSessions;
  }
  if (pendingSessions) return pendingSessions;

  const generation = cacheGeneration;
  const request = listSessionsAsync(onProgress);
  pendingSessions = request;

  try {
    const sessions = await request;
    if (generation === cacheGeneration) {
      cachedSessions = sessions;
      cacheTimestamp = Date.now();
      cacheDirMtime = getSessionsDirMtime();
    }
    return sessions;
  } finally {
    if (pendingSessions === request) pendingSessions = null;
  }
}

/** Clear session cache. */
export function clearSessionsCache(): void {
  cachedSessions = null;
  cacheTimestamp = 0;
  cacheDirMtime = 0;
  pendingSessions = null;
  cacheGeneration++;
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
  if (!content) return "Empty session";

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
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "Empty session";

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
    if (typeof entry.cwd === "string") scan.cwd = entry.cwd;
    if (typeof entry.timestamp === "string") scan.date = entry.timestamp;
    return;
  }
  if (entry.type === "session_info") {
    scan.explicitName = typeof entry.name === "string" && entry.name.trim()
      ? entry.name.trim()
      : undefined;
    return;
  }
  if (entry.type !== "message" || !entry.message) return;

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
    if (typeof message.model === "string") scan.model = message.model;
    if (typeof message.provider === "string") scan.provider = message.provider;
    scan.messageCount++;
  }
}

function scanSessionLine(scan: SessionScan, line: string): void {
  if (!line.trim()) return;
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

async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_SESSION_READS, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function parseSessionFileAsync(filePath: string): Promise<SessionSummary | null> {
  try {
    const stats = await stat(filePath);
    const input = createReadStream(filePath, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const scan = createSessionScan();
    try {
      for await (const line of lines) {
        scanSessionLine(scan, line);
      }
    } finally {
      lines.close();
      input.destroy();
    }
    return finishSessionSummary(filePath, scan, stats.mtimeMs, stats.mtime);
  } catch {
    return null;
  }
}

async function findSessionCandidates(): Promise<string[]> {
  const sessionsDir = getSessionsDir();
  try {
    const projects = (await readdir(sessionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory());
    const filesByProject = await Promise.all(projects.map(async (project) => {
      const projectPath = join(sessionsDir, project.name);
      try {
        return (await readdir(projectPath, { withFileTypes: true }))
          .filter((entry) => entry.name.endsWith(".jsonl"))
          .map((entry) => join(projectPath, entry.name));
      } catch {
        return [];
      }
    }));
    const candidates = await mapWithConcurrency(filesByProject.flat(), async (path) => {
      try {
        const stats = await stat(path);
        return stats.isFile() ? { path, mtime: stats.mtimeMs } : null;
      } catch {
        return null;
      }
    });

    return candidates
      .filter((entry): entry is { path: string; mtime: number } => entry !== null)
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, MAX_SESSIONS)
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

async function listSessionsAsync(onProgress?: SessionListProgress): Promise<SessionSummary[]> {
  const files = await findSessionCandidates();
  let loaded = 0;
  const summaries = await mapWithConcurrency(files, async (file) => {
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
 * List all session files and return parsed summaries, newest first.
 * Limits to MAX_SESSIONS to prevent OOM.
 */
export function listSessions(): SessionSummary[] {
  const sessionsDir = getSessionsDir();
  if (!existsSync(sessionsDir)) return [];

  const sessions: SessionSummary[] = [];
  let entries: string[];

  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }

  // Sessions are organized in subdirectories by project path
  for (const projectDir of entries) {
    if (sessions.length >= MAX_SESSIONS) break;

    const projectPath = join(sessionsDir, projectDir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }

    let sessionFiles: string[];
    try {
      sessionFiles = readdirSync(projectPath);
    } catch {
      continue;
    }

    for (const sessionFile of sessionFiles) {
      if (sessions.length >= MAX_SESSIONS) break;
      if (!sessionFile.endsWith(".jsonl")) continue;
      const fullPath = join(projectPath, sessionFile);
      const summary = parseSessionFile(fullPath);
      if (summary) {
        sessions.push(summary);
      }
    }
  }

  // Sort by mtime, newest first
  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions;
}

/**
 * Format a date string for display.
 * Parses ISO 8601 dates robustly, handling missing timezone.
 */
export function formatDate(isoStr: string): string {
  try {
    // Normalise: if no timezone offset/Z, treat as UTC
    const normalised = /\d{2}:\d{2}$/.test(isoStr) && !isoStr.endsWith("Z") && !isoStr.endsWith("+00:00")
      ? isoStr + "Z"
      : isoStr;
    const d = new Date(normalised);
    if (isNaN(d.getTime())) return "";
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
