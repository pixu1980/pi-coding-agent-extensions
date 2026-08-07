/**
 * pi-path-picker - internal helpers (delimiters, tilde/path resolution, listing)
 *
 * Private module: imported by the extension entry only, never by consumers.
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, join, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";

// ── Sensitive directories ─────────────────────────────────────────

const SENSITIVE_DIRECTORIES = new Set([
  join(homedir(), ".ssh"),
  join(homedir(), ".aws"),
  join(homedir(), ".config", "gh"),
  join(homedir(), ".gnupg"),
  join(homedir(), ".password-store"),
  join(homedir(), ".kube"),
  "/etc/ssh",
]);

export function isSensitiveDir(dirPath: string): boolean {
  const normalised = resolve(dirPath);
  for (const sensitive of SENSITIVE_DIRECTORIES) {
    if (normalised === sensitive || normalised.startsWith(sensitive + sep)) {
      return true;
    }
  }
  return false;
}

// ── Path resolution ───────────────────────────────────────────────

/**
 * Expand `~` at the start of a path to the home directory.
 */
export function expandTilde(path: string): string {
  if (path.startsWith("~" + sep) || path === "~") {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Resolve a path that may contain `~` or be relative to cwd.
 */
export function resolvePath(path: string, cwd: string): string {
  const expanded = expandTilde(path);
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
}

// ── Delimiter context ─────────────────────────────────────────────

/** Delimitatori supportati dal path autocomplete. */
const STRING_DELIMITERS = ['"', "'", "`"] as const;

export type DelimiterContext = "inside" | "broken" | "outside";

/** A character is escaped only when preceded by an odd number of consecutive backslashes. */
function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function countUnescaped(text: string, delimiter: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === delimiter && !isEscapedAt(text, i)) {
      count++;
    }
  }
  return count;
}

/**
 * Classifica il contesto relativo al cursore:
 * - inside: fra due delimitatori uguali non escaped;
 * - broken: apertura o chiusura mancante;
 * - outside: nessun contesto quotato relativo al cursore.
 */
export function getDelimiterContext(line: string, col: number): DelimiterContext {
  const beforeCursor = line.slice(0, col);
  const afterCursor = line.slice(col);
  const counts = STRING_DELIMITERS.map((delimiter) => ({
    before: countUnescaped(beforeCursor, delimiter),
    after: countUnescaped(afterCursor, delimiter),
  }));

  if (counts.some(({ before, after }) => before % 2 === 1 && after > 0)) {
    return "inside";
  }

  if (counts.some(({ before, after }) => before % 2 === 1 || after % 2 === 1)) {
    return "broken";
  }

  return "outside";
}

// ── Directory listing ─────────────────────────────────────────────

/**
 * List files/directories in a directory, filtering by a prefix.
 * Returns items sorted: directories first, then alphabetically.
 */
export function listPathItems(dirPath: string, prefix: string): Array<{ name: string; isDir: boolean; fullPath: string }> {
  // Refuse to list contents of sensitive directories
  if (isSensitiveDir(dirPath)) return [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const items: Array<{ name: string; isDir: boolean; fullPath: string }> = [];
  const lowerPrefix = prefix.toLowerCase();

  for (const entry of entries) {
    if (entry.startsWith(".") && !prefix.startsWith(".")) continue; // skip hidden unless query starts with .
    if (lowerPrefix && !entry.toLowerCase().startsWith(lowerPrefix)) continue;

    const fullPath = join(dirPath, entry);
    let isDir = false;
    try { isDir = statSync(fullPath).isDirectory(); } catch { /* skip unreadable */ }

    items.push({ name: entry, isDir, fullPath });
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

// ── Path token extraction ─────────────────────────────────────────

/**
 * Extract a potential path prefix from the text before the cursor.
 * Returns the path string and the start index of the path token.
 * ONLY triggers on explicit path patterns: ~/, ~, /path, ./path, ../path
 * Does NOT match random words to avoid interfering with native autocomplete.
 */
export function extractPathToken(textBeforeCursor: string): { path: string; startIndex: number } | null {
  // Match patterns that look like path starts - explicit only, no generic word fallback
  const patterns = [
    // ~/... or ~ (tilde path) - allow spaces since we're inside delimiters
    { re: /(~[^"'`]*)$/, group: 1 },
    // ./... or ../... (relative path) - allow spaces
    { re: /((?:\.\.?\/)[^"'`]*)$/, group: 1 },
    // /... (absolute path) - allow spaces
    { re: /(\/[^"'`]*)$/, group: 1 },
  ];

  for (const { re, group } of patterns) {
    const match = textBeforeCursor.match(re);
    if (match) {
      const path = match[group];
      if (path) {
        // `/` at the START of the line is a pi.dev command (e.g. /model, /caveman),
        // NOT a file path. Skip it - absolute paths always have something before them.
        if (match.index === 0 && path.startsWith("/")) {
          return null;
        }
        return { path, startIndex: match.index! + (match[0].length - match[group].length) };
      }
    }
  }

  return null;
}
