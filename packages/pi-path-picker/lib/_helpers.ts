/**
 * pi-path-picker - internal helpers (delimiters, tilde/path resolution, listing)
 *
 * Private module: imported by the extension entry only, never by consumers.
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// ── Sensitive directories ─────────────────────────────────────────

const SENSITIVE_DIRECTORIES = new Set([
  join(homedir(), '.ssh'),
  join(homedir(), '.aws'),
  join(homedir(), '.config', 'gh'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.password-store'),
  join(homedir(), '.kube'),
  '/etc/ssh',
]);

export function isSensitiveDir(dirPath: string): boolean {
  const normalized = resolve(dirPath);

  for (const sensitive of SENSITIVE_DIRECTORIES) {
    if (normalized === sensitive || normalized.startsWith(sensitive + sep)) {
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
  if (path.startsWith(`~${sep}`) || path === '~') {
    return join(homedir(), path.slice(1));
  }

  return path;
}

/**
 * Resolve a path that may contain `~` or be relative to cwd.
 */
export function resolvePath(path: string, cwd: string): string {
  const expanded = expandTilde(path);

  if (isAbsolute(expanded)) {
    return expanded;
  }

  return resolve(cwd, expanded);
}

// ── Delimiters and quote-region detection ─────────────────────────

/** Delimitatori supportati dal path autocomplete. */
const STRING_DELIMITERS = ['"', "'", '`'] as const;

/** A character is escaped only when preceded by an odd number of consecutive backslashes. */
function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;

  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
    backslashes++;
  }

  return backslashes % 2 === 1;
}

// ── Directory listing ─────────────────────────────────────────────

// Control characters (C0 range + DEL) never belong in a filename shown in
// a menu: they render as blank/garbled rows and their completion value
// would inject control codes into the prompt line. macOS artifacts like
// the Finder folder-icon file `Icon\r` are the classic case.
const INVALID_NAME = /[\u0000-\u001F\u007F]/;

/**
 * List files/directories in a directory, filtering by a prefix.
 * Returns items sorted: directories first, then alphabetically.
 *
 * Options:
 * - `includeHidden`: also list dotfiles/dot-directories (used by the
 *   detailed mode). Hidden entries are skipped otherwise.
 *
 * Entries whose name contains control characters (e.g. macOS `Icon\r`)
 * are skipped: they would render as empty rows and their value would
 * pollute the prompt.
 */
export function listPathItems(
  dirPath: string,
  prefix: string,
  options?: { includeHidden?: boolean }
): Array<{ name: string; isDir: boolean; fullPath: string }> {
  // Refuse to list contents of sensitive directories
  if (isSensitiveDir(dirPath)) {
    return [];
  }

  let entries: string[];

  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const items: Array<{ name: string; isDir: boolean; fullPath: string }> = [];
  const lowerPrefix = prefix.toLowerCase();
  const includeHidden = options?.includeHidden === true;

  for (const entry of entries) {
    if (INVALID_NAME.test(entry)) {
      continue;
    } // skip control-char names (Icon\r)

    if (entry.startsWith('.') && !includeHidden && !prefix.startsWith('.')) {
      continue;
    } // skip hidden unless query starts with .

    if (lowerPrefix && !includeHidden && !entry.toLowerCase().startsWith(lowerPrefix)) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    let isDir = false;

    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      /* skip unreadable */
    }

    items.push({ name: entry, isDir, fullPath });
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  return items;
}

// ── Quote-region detection (cursor-relative) ──────────────────────

/**
 * A quote region that touches the cursor: either a pair that is still
 * open (closing === null) or a pair whose closing delimiter sits exactly
 * at cursorCol - 1 (cursor immediately after the closing quote).
 */
export interface QuoteRegion {
  opening: number;
  closing: number | null;
  delimiter: string;
  cursorAfterClose: boolean;
}

function isStringDelimiter(c: string): boolean {
  return (STRING_DELIMITERS as readonly string[]).includes(c);
}

/**
 * Scan the line left of the cursor and classify the quote region that
 * touches the cursor.
 *
 * - An opening delimiter before the cursor whose pair is still open
 *   (e.g. `"./` with the cursor at 3) is a region: the natural way of
 *   typing a quoted path, and the primary trigger surface.
 * - A pair whose closing delimiter is exactly at cursorCol - 1
 *   (e.g. `"./"` with the cursor at 4) is a region as well: the user
 *   just closed the pair, and the path token lives between the two
 *   delimiters.
 * - Anything else (no quotes, or the cursor far away from the last
 *   pair) returns null: the native provider owns the context.
 *
 * Unlike a naive delimiter parity count, this scanner tracks the active
 * delimiter, so an apostrophe or different quote inside a pair (e.g.
 * `"./it's"` or `"a 'b' c"`) is plain text, not a broken pair.
 */
export function findQuoteRegion(line: string, col: number): QuoteRegion | null {
  let active: string | null = null;
  let opening = -1;
  let closing = -1;

  for (let i = 0; i < col; i++) {
    const c = line[i];

    if (c === undefined) {
      break;
    }

    if (isEscapedAt(line, i)) {
      continue;
    }

    if (active !== null) {
      if (c === active) {
        active = null;
        closing = i;
      }

      continue;
    }

    if (isStringDelimiter(c)) {
      active = c;
      opening = i;
    }
  }

  if (active !== null) {
    return { opening, closing: null, delimiter: active, cursorAfterClose: false };
  }

  if (opening !== -1 && closing === col - 1) {
    return { opening, closing, delimiter: line[opening] ?? '"', cursorAfterClose: true };
  }

  return null;
}

// ── Path token extraction ─────────────────────────────────────────

// A path token must start at the beginning of the region text or right
// after a word/argument delimiter, so `a/b` can never grab `/b` as an
// absolute path and `foo~/x` never matches `~/x`.
const TOKEN_BOUNDARY = /[\s=("'`]/;

/**
 * Extract a potential path prefix from text taken from INSIDE a quote
 * region (between the opening delimiter and the cursor/closing quote).
 * Returns the path string and the start index relative to that text.
 *
 * ONLY triggers on explicit path patterns: ~/, ~, /path, ./path, ../path.
 * Inside a quoted region there are no quote characters left, so paths
 * may contain spaces and the other quote characters (e.g. `./it's`).
 * A match is accepted only at a token boundary, which prevents relative
 * paths without a leading `./` from matching a trailing absolute pattern.
 */
export function extractPathToken(text: string): { path: string; startIndex: number } | null {
  const patterns = [
    // ~/... or ~ (tilde path)
    { re: /(~[^\n]*)$/, group: 1 },
    // ./... or ../... (relative path)
    { re: /((?:\.\.?\/)[^\n]*)$/, group: 1 },
    // /... (absolute path)
    { re: /(\/[^\n]*)$/, group: 1 },
  ];

  for (const { re, group } of patterns) {
    const match = text.match(re);

    if (!match) {
      continue;
    }

    const path = match[group];

    if (path === undefined || path === '') {
      continue;
    }

    const index = match.index ?? 0;

    if (index > 0 && !TOKEN_BOUNDARY.test(text[index - 1])) {
      continue;
    }

    return { path, startIndex: index + (match[0].length - path.length) };
  }

  return null;
}

/**
 * Join a directory prefix and a name, keeping exactly one separator
 * between them. Avoids the classic `dirname("/e") + "/" + "etc" === "//etc"`
 * double-slash bug for absolute paths under the filesystem root.
 */
export function joinPath(dir: string, name: string): string {
  if (!dir) {
    return name;
  }

  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}
