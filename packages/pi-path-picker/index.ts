/**
 * Path Picker Extension - Interactive file path autocomplete
 *
 * Provides:
 * - **Editor autocomplete**: ~/ and /-based path completion with fuzzy filtering
 *   directly in the prompt input field, solo su Tab e dentro backtick/single/double quotes
 *
 * Features:
 * - Fuzzy text filter as you type
 * - Tab to enter directories, Enter to select
 * - Inline `~` expansion and path autocomplete in the input field
 *
 * Install: pi install npm:pi-path-picker
 * Requires: Node.js ≥ 22 (for --experimental-strip-types)
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, join, sep, basename, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-coding-agent";

/**
 * Directories whose contents should NOT be shown in path autocomplete
 * to prevent accidental exposure of sensitive files.
 * Users can still navigate into them manually via other means.
 */
const SENSITIVE_DIRECTORIES = new Set([
  join(homedir(), ".ssh"),
  join(homedir(), ".aws"),
  join(homedir(), ".config", "gh"),
  join(homedir(), ".gnupg"),
  join(homedir(), ".password-store"),
  join(homedir(), ".kube"),
  "/etc/ssh",
]);

function isSensitiveDir(dirPath: string): boolean {
  const normalised = resolve(dirPath);
  for (const sensitive of SENSITIVE_DIRECTORIES) {
    if (normalised === sensitive || normalised.startsWith(sensitive + sep)) {
      return true;
    }
  }
  return false;
}


/**
 * Expand `~` at the start of a path to the home directory.
 */
function expandTilde(path: string): string {
  if (path.startsWith("~" + sep) || path === "~") {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Resolve a path that may contain `~` or be relative to cwd.
 */
function resolvePath(path: string, cwd: string): string {
  const expanded = expandTilde(path);
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
}

/**
 * Check if the cursor position is inside a pair of double quotes ("), backticks (`), or single quotes (').
 * The autocomplete should ONLY fire when the user is typing inside these delimiters.
 * Accounts for escaped delimiters (\", \`, \').
 *
 * Examples where this returns true:
 *   "src/components/|"          cursor at |
 *   `src/components/|`          cursor at |
 *   'src/components/|'          cursor at |
 *
 * Examples where this returns false:
 *   const x = src/compo|nents   cursor at |
 *   cd src/|                    cursor at |
 *   /model                      cursor at |  (pi.dev command)
 */
function cursorInsideAllowedDelimiters(line: string, col: number): boolean {
  const beforeCursor = line.slice(0, col);
  const afterCursor = line.slice(col);

  // Count unescaped delimiters (not preceded by backslash)
  function countUnescaped(str: string, char: string): number {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === char && (i === 0 || str[i - 1] !== "\\")) {
        count++;
      }
    }
    return count;
  }

  // Inside double quotes: odd number of unescaped " before cursor, at least one unescaped " after
  const doubleQuoteCountBefore = countUnescaped(beforeCursor, '"');
  const doubleQuoteCountAfter = countUnescaped(afterCursor, '"');
  if (doubleQuoteCountBefore % 2 === 1 && doubleQuoteCountAfter >= 1) {
    return true;
  }

  // Inside backticks: odd number of unescaped ` before cursor, at least one unescaped ` after
  const backtickCountBefore = countUnescaped(beforeCursor, '`');
  const backtickCountAfter = countUnescaped(afterCursor, '`');
  if (backtickCountBefore % 2 === 1 && backtickCountAfter >= 1) {
    return true;
  }

  // Inside single quotes: odd number of unescaped ' before cursor, at least one unescaped ' after
  const singleQuoteCountBefore = countUnescaped(beforeCursor, "'");
  const singleQuoteCountAfter = countUnescaped(afterCursor, "'");
  if (singleQuoteCountBefore % 2 === 1 && singleQuoteCountAfter >= 1) {
    return true;
  }

  return false;
}

/**
 * List files/directories in a directory, filtering by a prefix.
 * Returns items sorted: directories first, then alphabetically.
 */
function listPathItems(dirPath: string, prefix: string): Array<{ name: string; isDir: boolean; fullPath: string }> {
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

/**
 * Extract a potential path prefix from the text before the cursor.
 * Returns the path string and the start index of the path token.
 * ONLY triggers on explicit path patterns: ~/, ~, /path, ./path, ../path
 * Does NOT match random words to avoid interfering with native autocomplete.
 */
function extractPathToken(textBeforeCursor: string): { path: string; startIndex: number } | null {
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

export default function pathPickerExtension(pi: ExtensionAPI) {
  // ── Inline path autocomplete in the TUI input field ────────────
  // Provides shell-like Tab completion for ~, /, and relative paths
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current: AutocompleteProvider) => createPathAutocompleteProvider(current, ctx.cwd));
  });

}

/**
 * Create an autocomplete provider for file paths.
 * Wraps the built-in provider and adds ~ expansion and path-aware completion.
 */
function createPathAutocompleteProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
  return {
    // `/` e `~` sono trigger characters per l'autocomplete nativo di pi.
    // Fuori dagli apici:
    //   • `/` all'inizio della riga → comando pi.dev (/model, /caveman)
    //   • `/` dopo spazio o testo → NON è un comando, sopprimiamo
    //   • `~` → sopprimiamo (tilde fuori dalle stringhe è raro)
    // Dentro gli apici:
    //   • `~` → path autocomplete immediato
    //   • `/` → path autocomplete immediato (absolute path)
    //   • TAB → path autocomplete per /, ~, ./ .. /
    triggerCharacters: ["~", "/", "\"", "'", "`"],

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);

      // ── Outside delimiters ──────────────────────────────────
      // When the cursor is outside quotes, we should NEVER show path
      // autocomplete - the path picker only activates inside quotes.
      //
      // The only exception: pi.dev commands starting with `/` at the
      // start of the line (e.g., /model, /caveman) are delegated to
      // the native provider for its built-in command completion.
      //
      // Everything else (TAB, Backspace, typed chars) returns null,
      // which closes any stale path-picker menu. This ensures that
      // deleting a quote character (or moving the cursor outside)
      // immediately dismisses the autocomplete list.
      //
      // Note: we intentionally IGNORE options.force here - the old
      // code delegated to native when force=true, but that meant pi
      // would ALWAYS delegate on re-query (pi may set force=true for
      // all active-menu queries), keeping stale suggestions visible.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        if (textBeforeCursor.startsWith("/")) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        }
        return null;
      }

      // ── Inside delimiters: path autocomplete ───────────────
      // Works on:
      //   • `~` trigger character (immediate)
      //   • TAB when cursor is after a path pattern (/ ~ ./ ../)

      const token = extractPathToken(textBeforeCursor);
      if (!token || options.signal.aborted) {
        return null;
      }

      const { path } = token;

      try {
        // Determine the directory to search and the file prefix
        let dirPath: string;
        let filePrefix: string;

        if (path.endsWith("/") || path === "~") {
          // User typed a directory: list its contents
          dirPath = resolvePath(path, cwd);
          filePrefix = "";
        } else {
          // User typed a partial name: find the parent dir and filter
          const parentDir = dirname(path);
          filePrefix = basename(path);
          const resolvedParent = parentDir === "." ? cwd : resolvePath(parentDir, cwd);
          dirPath = resolvedParent;
        }

        const items = listPathItems(dirPath, filePrefix);
        if (items.length === 0 || options.signal.aborted) {
          return null;
        }

        // Convert to autocomplete items
        const autocompleteItems: AutocompleteItem[] = items.map((item) => {
          const suffix = item.isDir ? "/" : "";
          return {
            value: path.endsWith("/") ? `${path}${item.name}${suffix}` : `${dirname(path)}/${item.name}${suffix}`,
            label: item.isDir ? `📁 ${item.name}/` : `📄 ${item.name}`,
            description: item.isDir ? "directory" : "file",
          };
        });

        return {
          items: autocompleteItems.slice(0, 30),
          prefix: path,
        };
      } catch {
        return null;
      }
    },

    applyCompletion(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      item: AutocompleteItem,
      prefix: string,
    ): { lines: string[]; cursorLine: number; cursorCol: number } {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const textAfterCursor = currentLine.slice(cursorCol);
      const token = cursorInsideAllowedDelimiters(currentLine, cursorCol) ? extractPathToken(textBeforeCursor) : null;

      // If the suggestions came from the wrapped/native provider (slash commands,
      // @ files, command arguments, etc.), delegate completion back to it.
      if (!token || token.path !== prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

      // Use the custom completion from the picker provider
      const completion = item.value;
      const tokenStart = token.startIndex;

      const newLine = currentLine.slice(0, tokenStart) + completion + textAfterCursor;

      const newLines = [...lines];
      newLines[cursorLine] = newLine;

      return {
        lines: newLines,
        cursorLine,
        cursorCol: tokenStart + completion.length,
      };
    },

    shouldTriggerFileCompletion(_lines, _cursorLine, _cursorCol) {
      // Always return true so pi re-queries getSuggestions on every
      // keystroke. Returning false would make pi skip getSuggestions,
      // leaving the menu open with stale data - the root cause of the
      // bug where deleting a quote character does NOT close the list.
      return true;
    },
  };
}
