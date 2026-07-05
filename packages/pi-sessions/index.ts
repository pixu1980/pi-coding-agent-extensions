/**
 * Sessions Extension — Browse, search, and restore past sessions
 *
 * Features:
 * - `/sessions` command to toggle session history overlay
 * - Auto-names sessions based on first user message (truncated to ~60 chars)
 * - Shows: session name, date, message count, model used
 * - Keyboard navigation (↑ ↓) and Enter to restore
 * - Search/filter as you type
 * - Integrates with pi.dev's native session system
 *
 * Install: pi install npm:@pixu1980/pi-sessions
 * Usage: /sessions
 *
 * The overlay appears as a right-side panel with a compact session list.
 * Select a session to call `/resume` and load it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from "@earendil-works/pi-tui";

// ── Types ──────────────────────────────────────────────────────────

interface SessionSummary {
  /** Full path to the session JSONL file */
  file: string;
  /** Auto-generated name from first user message */
  name: string;
  /** ISO timestamp of first message */
  date: string;
  /** Total message count (user + assistant + tool) */
  messageCount: number;
  /** Model used (from last assistant message) */
  model?: string;
  /** Provider used */
  provider?: string;
  /** CWD when session was created */
  cwd?: string;
  /** Last modified time (file mtime) */
  mtime: number;
  /** Last user message content (truncated) */
  lastUserMessage?: string;
}

// ── Folder Summary ─────────────────────────────────────────────────

interface FolderSummary {
  /** Project directory path */
  folder: string;
  /** Sessions in this folder (newest first) */
  sessions: SessionSummary[];
  /** Number of sessions in this folder */
  sessionCount: number;
  /** Total messages across all sessions in this folder */
  totalMessages: number;
  /** ISO timestamp of the most recent session */
  latestDate: string;
  /** Model used in the most recent session */
  latestModel?: string;
  /** Last user message from the most recent session */
  lastUserMessage?: string;
}

// ── Constants ──────────────────────────────────────────────────────

const SESSION_DIR_NAME = "sessions";
const MAX_NAME_LENGTH = 60;
const SIDEBAR_WIDTH = 68;
/** Maximum number of sessions to load (prevents OOM with thousands of files). */
const MAX_SESSIONS = 500;
/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 300_000;

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
function getSessions(): SessionSummary[] {
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
function clearSessionsCache(): void {
  cachedSessions = null;
  cacheTimestamp = 0;
  cacheDirMtime = 0;
}
/**
 * Overhead rows in the sidebar UI (borders, header, search bar, footer):
 *   ┌────┐   top border
 *   │    │   header (Sessions)
 *   ├────┤   separator
 *   │    │   search bar
 *   ├────┤   separator
 *   │    │   session items (variable)
 *   ├────┤   separator
 *   │    │   footer hint
 *   └────┘   bottom border
 * = 8 fixed rows
 */
const SIDEBAR_OVERHEAD = 8;

// ── Session Listing ────────────────────────────────────────────────

/**
 * Get the pi.dev sessions directory.
 */
function getSessionsDir(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, SESSION_DIR_NAME);
}

/**
 * Type guard for a text content block in a message content array.
 */
interface TextContentBlock {
  type: "text";
  text: string;
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
function autoNameSession(content: unknown): string {
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
function parseSessionFile(filePath: string): SessionSummary | null {
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
function listSessions(): SessionSummary[] {
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
function formatDate(isoStr: string): string {
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

// ── Folder Grouping ─────────────────────────────────────────────────

/**
 * Group sessions by project directory (cwd).
 * Returns folders sorted by latest session date, newest first.
 */
function groupSessionsByFolder(sessions: SessionSummary[]): FolderSummary[] {
  const groups = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const folder = session.cwd || "unknown";
    const existing = groups.get(folder);
    if (existing) {
      existing.push(session);
    } else {
      groups.set(folder, [session]);
    }
  }

  const folders: FolderSummary[] = [];
  for (const [folder, folderSessions] of groups) {
    const latestSession = folderSessions[0]!;
    const totalMessages = folderSessions.reduce((sum, s) => sum + s.messageCount, 0);
    folders.push({
      folder,
      sessions: folderSessions,
      sessionCount: folderSessions.length,
      totalMessages,
      latestDate: latestSession.date,
      latestModel: latestSession.model,
      lastUserMessage: latestSession.lastUserMessage,
    });
  }

  folders.sort((a, b) => {
    return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
  });

  return folders;
}

// ── Sidebar Component ──────────────────────────────────────────────

class SessionSidebarComponent implements Focusable {
  /** Focusable interface - set by TUI when focus changes */
  focused = false;

  private sessions: SessionSummary[] = [];
  private filtered: SessionSummary[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private query = "";
  private theme: Theme;
  private done: (result: SessionSummary | undefined) => void;
  private width: number;
  /** Number of session items that fit in the overlay */
  private visibleItems: number;

  private title: string;

  constructor(
    theme: Theme,
    sessions: SessionSummary[],
    done: (result: SessionSummary | undefined) => void,
    terminalRows: number,
    title = "📋 Sessions",
  ) {
    this.theme = theme;
    this.sessions = sessions;
    this.filtered = [...sessions];
    this.done = done;
    this.title = title;
    this.width = SIDEBAR_WIDTH;
    // Overlay: 55% of terminal minus overhead
    const overlayHeight = Math.floor(terminalRows * 0.55);
    this.visibleItems = Math.min(10, Math.max(3, overlayHeight - SIDEBAR_OVERHEAD));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
        this.done(selected);
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        // Scroll when cursor goes above the visible window
        if (this.selectedIndex < this.scrollOffset) {
          this.scrollOffset = this.selectedIndex;
        }
      }
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.filtered.length - 1) {
        this.selectedIndex++;
        // Scroll when cursor goes below the visible window
        if (this.selectedIndex >= this.scrollOffset + this.visibleItems) {
          this.scrollOffset = this.selectedIndex - this.visibleItems + 1;
        }
      }
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = this.filtered.length - 1;
      this.scrollOffset = Math.max(0, this.selectedIndex - this.visibleItems + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleItems);
      this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleItems);
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(
        this.filtered.length - 1,
        this.selectedIndex + this.visibleItems,
      );
      this.scrollOffset = Math.min(
        this.filtered.length - this.visibleItems,
        this.scrollOffset + this.visibleItems,
      );
    } else if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.selectedIndex = 0;
        this.scrollOffset = 0;
      }
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      // Printable character — filter
      this.query += data;
      this.applyFilter();
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.ctrl("c"))) {
      this.done(undefined);
    }
  }

  private applyFilter(): void {
    if (!this.query) {
      this.filtered = [...this.sessions];
      return;
    }

    const q = this.query.toLowerCase();
    this.filtered = this.sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.lastUserMessage && s.lastUserMessage.toLowerCase().includes(q)) ||
        (s.model && s.model.toLowerCase().includes(q)) ||
        (s.cwd && s.cwd.toLowerCase().includes(q)),
    );
  }

  render(_width: number): string[] {
    const w = this.width;
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const pad = (s: string, len: number) => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string) =>
      th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

    const selectedStyle = (s: string) => th.bg("selectedBg", th.fg("accent", s));
    const normalStyle = (s: string) => th.fg("text", s);

    // ── Header ──
    // Overlay: rounded top, compact popup style
    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(
      row(
        ` ${th.fg("accent", th.bold(this.title))} ${th.fg("dim", `(${this.sessions.length})`)}`,
      ),
    );
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Search bar ──
    const searchLabel = th.fg("dim", "🔍 ");
    const searchPrefix = this.focused ? "" : "";
    const cursorMark = this.focused ? "" : "";
    const searchText = this.query || th.fg("dim", "Filter...");
    const searchLine = `${searchLabel}${searchPrefix}${searchText}${cursorMark}`;
    lines.push(row(searchLine));
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Sessions list ──
    const displayItems = this.filtered.slice(
      this.scrollOffset,
      this.scrollOffset + this.visibleItems,
    );

    if (displayItems.length === 0) {
      lines.push(row(` ${th.fg("dim", "No sessions found")}`));
    } else {
      for (let i = 0; i < displayItems.length; i++) {
        const session = displayItems[i]!;
        const idx = this.scrollOffset + i;
        const isSelected = idx === this.selectedIndex;

        // Folder / project path (prominent)
        const folderDisplay = session.cwd
          ? session.cwd.replace(homedir(), "~")
          : "unknown";
        const folderStr = truncateToWidth(folderDisplay, innerW - 8);
        const folderLine = isSelected
          ? selectedStyle(` ▶ 📁 ${folderStr}`)
          : normalStyle(`   📁 ${folderStr}`);
        lines.push(row(folderLine));

        // Last user message
        if (session.lastUserMessage) {
          const msgStr = truncateToWidth(session.lastUserMessage, innerW - 6);
          const msgLine = `  ${th.fg("text", `"${msgStr}"`)}`;
          lines.push(row(isSelected ? selectedStyle(msgLine) : msgLine));
        }

        // Session meta: date + messages + model
        const dateStr = formatDate(session.date);
        const metaParts: string[] = [];
        if (dateStr) metaParts.push(dateStr);
        metaParts.push(`${session.messageCount} msgs`);
        if (session.model) {
          const shortModel = session.model.includes("/")
            ? session.model.split("/").pop() ?? session.model
            : session.model;
          metaParts.push(shortModel);
        }
        if (session.provider) {
          metaParts.push(session.provider);
        }
        const metaStr = truncateToWidth(
          `  ${th.fg("dim", metaParts.join(" · "))}`,
          innerW - 2,
        );
        lines.push(row(isSelected ? selectedStyle(metaStr) : metaStr));

        // Spacer between sessions
        if (i < displayItems.length - 1) {
          lines.push(row(""));
        }
      }
    }

    // ── Footer ──
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // Scroll indicators
    const aboveCount = this.scrollOffset;
    const belowCount = Math.max(0, this.filtered.length - (this.scrollOffset + this.visibleItems));
    let scrollHint = "";
    if (aboveCount > 0) scrollHint += `↑${aboveCount} `;
    if (belowCount > 0) scrollHint += `↓${belowCount} `;

    const footerHint =
      this.filtered.length > 0
        ? `${scrollHint}↑↓ navigate • Enter load • ${this.filtered.length} total`
        : "Esc close";
    lines.push(row(` ${th.fg("dim", truncateToWidth(footerHint, innerW - 2))}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

// ── Folder Sidebar Component ───────────────────────────────────────

class FolderSidebarComponent implements Focusable {
  focused = false;

  private folders: FolderSummary[] = [];
  private filtered: FolderSummary[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private query = "";
  private theme: Theme;
  private done: (result: FolderSummary | undefined) => void;
  private width: number;
  private visibleItems: number;

  constructor(
    theme: Theme,
    folders: FolderSummary[],
    done: (result: FolderSummary | undefined) => void,
    terminalRows: number,
  ) {
    this.theme = theme;
    this.folders = folders;
    this.filtered = [...folders];
    this.done = done;
    this.width = SIDEBAR_WIDTH;
    const overlayHeight = Math.floor(terminalRows * 0.55);
    this.visibleItems = Math.min(10, Math.max(3, overlayHeight - SIDEBAR_OVERHEAD));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
        this.done(selected);
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        if (this.selectedIndex < this.scrollOffset) {
          this.scrollOffset = this.selectedIndex;
        }
      }
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.filtered.length - 1) {
        this.selectedIndex++;
        if (this.selectedIndex >= this.scrollOffset + this.visibleItems) {
          this.scrollOffset = this.selectedIndex - this.visibleItems + 1;
        }
      }
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = this.filtered.length - 1;
      this.scrollOffset = Math.max(0, this.selectedIndex - this.visibleItems + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleItems);
      this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleItems);
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + this.visibleItems);
      this.scrollOffset = Math.min(this.filtered.length - this.visibleItems, this.scrollOffset + this.visibleItems);
    } else if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.selectedIndex = 0;
        this.scrollOffset = 0;
      }
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.query += data;
      this.applyFilter();
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    }
  }

  private applyFilter(): void {
    if (!this.query) {
      this.filtered = [...this.folders];
      return;
    }

    const q = this.query.toLowerCase();
    this.filtered = this.folders.filter(
      (f) =>
        f.folder.toLowerCase().includes(q) ||
        (f.lastUserMessage && f.lastUserMessage.toLowerCase().includes(q)) ||
        (f.latestModel && f.latestModel.toLowerCase().includes(q)),
    );
  }

  render(_width: number): string[] {
    const w = this.width;
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const pad = (s: string, len: number) => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string) =>
      th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

    const selectedStyle = (s: string) => th.bg("selectedBg", th.fg("accent", s));
    const normalStyle = (s: string) => th.fg("text", s);

    // ── Header ──
    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(
      row(
        ` ${th.fg("accent", th.bold("📁 Projects"))} ${th.fg("dim", `(${this.folders.length})`)}`,
      ),
    );
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Search bar ──
    const searchLabel = th.fg("dim", "🔍 ");
    const searchText = this.query || th.fg("dim", "Filter...");
    const searchLine = `${searchLabel}${searchText}`;
    lines.push(row(searchLine));
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Folder list ──
    const displayItems = this.filtered.slice(this.scrollOffset, this.scrollOffset + this.visibleItems);

    if (displayItems.length === 0) {
      lines.push(row(` ${th.fg("dim", "No projects found")}`));
    } else {
      for (let i = 0; i < displayItems.length; i++) {
        const folder = displayItems[i]!;
        const idx = this.scrollOffset + i;
        const isSelected = idx === this.selectedIndex;

        // Folder path
        const displayPath = folder.folder.replace(homedir(), "~");
        const folderStr = truncateToWidth(displayPath, innerW - 8);
        const folderLine = isSelected
          ? selectedStyle(` ▶ 📁 ${folderStr}`)
          : normalStyle(`   📁 ${folderStr}`);
        lines.push(row(folderLine));

        // Last user message from latest session
        if (folder.lastUserMessage) {
          const msgStr = truncateToWidth(folder.lastUserMessage, innerW - 6);
          const msgLine = `  ${th.fg("text", `"${msgStr}"`)}`;
          lines.push(row(isSelected ? selectedStyle(msgLine) : msgLine));
        }

        // Aggregated metadata
        const dateStr = formatDate(folder.latestDate);
        const metaParts: string[] = [];
        if (dateStr) metaParts.push(dateStr);
        metaParts.push(`${folder.sessionCount} sessions`);
        metaParts.push(`${folder.totalMessages} msgs`);
        if (folder.latestModel) {
          const shortModel = folder.latestModel.includes("/")
            ? folder.latestModel.split("/").pop() ?? folder.latestModel
            : folder.latestModel;
          metaParts.push(shortModel);
        }
        const metaStr = truncateToWidth(
          `  ${th.fg("dim", metaParts.join(" · "))}`,
          innerW - 2,
        );
        lines.push(row(isSelected ? selectedStyle(metaStr) : metaStr));

        // Spacer
        if (i < displayItems.length - 1) {
          lines.push(row(""));
        }
      }
    }

    // ── Footer ──
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    const aboveCount = this.scrollOffset;
    const belowCount = Math.max(0, this.filtered.length - (this.scrollOffset + this.visibleItems));
    let scrollHint = "";
    if (aboveCount > 0) scrollHint += `↑${aboveCount} `;
    if (belowCount > 0) scrollHint += `↓${belowCount} `;

    const footerHint = this.filtered.length > 0
      ? `${scrollHint}↑↓ navigate • Enter drill-down • ${this.filtered.length} total`
      : "Esc close";
    lines.push(row(` ${th.fg("dim", truncateToWidth(footerHint, innerW - 2))}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

// ── Extension Entry ────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  // ── Register /sessions (overlay popup) ──
  pi.registerCommand("sessions", {
    description: "Open session history overlay. Navigate ↑↓, type to filter, Enter to restore.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await showSessionSidebar(ctx);
    },
  });

  // ── Register /sessions-folders (project overview with drill-down) ──
  pi.registerCommand("sessions-folders", {
    description: "Browse sessions by project folder. Shows aggregated info per folder with drill-down to individual sessions.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await showFolderSidebar(ctx);
    },
  });

  // ── Auto-name sessions on start ───────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // If session has no display name, try to derive one from the first user message
    const currentName = pi.getSessionName();
    if (!currentName) {
      const entries = ctx.sessionManager.getEntries();
      for (const entry of entries) {
        if (
          entry.type === "message" &&
          entry.message &&
          "role" in entry.message &&
          entry.message.role === "user"
        ) {
          const name = autoNameSession(entry.message.content);
          if (name && name !== "Empty session") {
            pi.setSessionName(name);
          }
          break;
        }
      }
    }
  });
}

/**
 * Show the session history overlay (popup mode).
 */
async function showSessionSidebar(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Session overlay requires TUI mode.", "error");
    return;
  }

  // Show loading state
  ctx.ui.notify("Loading sessions...", "info");

  try {
    const sessions = getSessions();
    if (sessions.length === 0) {
      ctx.ui.notify("No sessions found.", "info");
      return;
    }

    const overlayOptions = {
      anchor: "right-center" as const,
      width: SIDEBAR_WIDTH + 2,
      minWidth: 40,
      height: "55%",
      margin: 1,
    };

    const result = await ctx.ui.custom<SessionSummary | undefined>(
      (tui, theme, _keybindings, done) =>
        new SessionSidebarComponent(theme, sessions, done, tui.terminal.rows),
      {
        overlay: true,
        overlayOptions,
      },
    );

    if (result) {
      // User selected a session — restore it
      ctx.ui.notify(`Loading session: ${result.name}`, "info");
      await loadSession(ctx, result.file);
    }
  } catch (error) {
    console.error("[pi-sessions] Error in showSessionSidebar:", error);
    ctx.ui.notify(
      `Error loading sessions: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }
}

/**
 * Show the folder overview overlay with drill-down to session list.
 * Uses a loop so Esc in drill-down returns to folder list.
 */
async function showFolderSidebar(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Folder overview requires TUI mode.", "error");
    return;
  }

  ctx.ui.notify("Loading projects...", "info");

  try {
    const sessions = getSessions();
    const folders = groupSessionsByFolder(sessions);

    if (folders.length === 0) {
      ctx.ui.notify("No sessions found.", "info");
      return;
    }

    const overlayOptions = {
      anchor: "right-center" as const,
      width: SIDEBAR_WIDTH + 2,
      minWidth: 40,
      height: "55%",
      margin: 1,
    };

    // Navigation loop: folder list → session list → load or back
    // Safety limit prevents infinite loops from edge cases.
    let navDepth = 0;
    const MAX_NAV_DEPTH = 10;
    while (navDepth < MAX_NAV_DEPTH) {
      navDepth++;

      const folderResult = await ctx.ui.custom<FolderSummary | undefined>(
        (tui, theme, _keybindings, done) =>
          new FolderSidebarComponent(theme, folders, done, tui.terminal.rows),
        { overlay: true, overlayOptions },
      );

      if (!folderResult) break; // Esc → exit

      // Drill down: show sessions for this folder
      const sessionResult = await ctx.ui.custom<SessionSummary | undefined>(
        (tui, theme, _keybindings, done) =>
          new SessionSidebarComponent(
            theme,
            folderResult.sessions,
            done,
            tui.terminal.rows,
            `📁 ${folderResult.folder.replace(homedir(), "~")}`,
          ),
        { overlay: true, overlayOptions },
      );

      if (sessionResult) {
        ctx.ui.notify(`Loading session: ${sessionResult.name}`, "info");
        await loadSession(ctx, sessionResult.file);
        break; // session loaded
      }
      // sessionResult === undefined (Esc) → loop back to folder list
    }
  } catch (error) {
    console.error("[pi-sessions] Error in showFolderSidebar:", error);
    ctx.ui.notify(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }
}

/**
 * Load a session file by calling pi's native session switching.
 */
async function loadSession(
  ctx: ExtensionCommandContext,
  sessionFile: string,
): Promise<void> {
  try {
    // Use ctx.switchSession to load the selected session
    const result = await ctx.switchSession(sessionFile, {
      withSession: async (newCtx) => {
        newCtx.ui.notify("Session restored successfully", "info");
      },
    });

    if (result && "cancelled" in result && result.cancelled) {
      ctx.ui.notify("Session switch cancelled.", "warning");
    }
  } catch (error) {
    console.error(
      `[pi-sessions] Failed to switch to session ${sessionFile}:`,
      error instanceof Error ? error.message : error,
    );
    ctx.ui.notify(
      `Could not switch directly. Try /resume to select the session.`,
      "warning",
    );
  }
}
