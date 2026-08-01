/**
 * pi-sessions — session file discovery and parsing (private module)
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { SESSION_DIR_NAME, MAX_NAME_LENGTH, MAX_SESSIONS, CACHE_TTL_MS } from "./_constants.ts";
import type { SessionSummary, TextContentBlock } from "./_types.ts";

// ── Session Cache ───────────────────────────────────────────────────

let cachedSessions: SessionSummary[] | null = null;
let cacheTimestamp = 0;
let cacheDirMtime = 0;

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

/**
 * Get sessions with caching. Cache is invalidated when the sessions
 * directory modification time changes.
 */
export function getSessions(): SessionSummary[] {
  const now = Date.now();
  const currentMtime = getSessionsDirMtime();

  if (cachedSessions && (now - cacheTimestamp) < CACHE_TTL_MS && currentMtime === cacheDirMtime) {
    return cachedSessions;
  }

  cachedSessions = listSessions();
  cacheTimestamp = now;
  cacheDirMtime = currentMtime;
  return cachedSessions;
}

/** Clear session cache. */
export function clearSessionsCache(): void {
  cachedSessions = null;
  cacheTimestamp = 0;
  cacheDirMtime = 0;
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

/**
 * Parse a session JSONL file and extract summary info.
 */
export function parseSessionFile(filePath: string): SessionSummary | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");
    if (lines.length === 0) return null;

    const stats = statSync(filePath);
    let name = "Unknown session";
    let date = "";
    let messageCount = 0;
    let model: string | undefined;
    let provider: string | undefined;
    let cwd: string | undefined;
    let lastUserMessage: string | undefined;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "session") {
          cwd = entry.cwd;
          date = entry.timestamp || "";
        } else if (entry.type === "message" && entry.message) {
          // First user message → derive name
          if (entry.message.role === "user" && !name || name === "Unknown session") {
            name = autoNameSession(entry.message.content);
          }
          // Last user message (overwritten on each user message)
          if (entry.message.role === "user") {
            lastUserMessage = autoNameSession(entry.message.content);
          }
          // Track model from last assistant message
          if (entry.message.role === "assistant") {
            if (entry.message.model) model = entry.message.model;
            if (entry.message.provider) provider = entry.message.provider;
          }
          // Count user + assistant messages only (skip tool results for count display)
          if (entry.message.role === "user" || entry.message.role === "assistant") {
            messageCount++;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      file: filePath,
      name,
      date: date || stats.mtime.toISOString(),
      messageCount,
      model,
      provider,
      cwd,
      mtime: stats.mtimeMs,
      lastUserMessage,
    };
  } catch {
    return null;
  }
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
