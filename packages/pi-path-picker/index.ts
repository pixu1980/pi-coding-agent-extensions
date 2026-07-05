/**
 * Path Picker Extension — Interactive file path autocomplete
 *
 * Provides:
 * - `/pick` command: interactive path browser with arrow keys
 * - **Editor autocomplete**: ~/ and /-based path completion with fuzzy filtering
 *   directly in the prompt input field, solo su Tab e dentro backtick/single/double quotes
 *
 * Features:
 * - Arrow key navigation (↑ ↓) in `/pick`
 * - Fuzzy text filter as you type
 * - Tab to enter directories, Enter to select
 * - Glob pattern matching (tool mode)
 * - Inline `~` expansion and path autocomplete in the input field
 *
 * Install: pi install npm:pi-path-picker
 * Requires: Node.js ≥ 22 (for --experimental-strip-types)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep, basename, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-coding-agent";

const PICKER_SCRIPT = new URL("pick-path.ts", import.meta.url).pathname;

/**
 * Ensure the picker script exists.
 */
function ensurePickerScript(): string {
  if (existsSync(PICKER_SCRIPT)) return PICKER_SCRIPT;
  return "";
}

/**
 * Build the node command to run the picker script.
 * Uses --experimental-strip-types for native TS execution (Node ≥ 22).
 */
function pickerCommand(args: string[]): { command: string; args: string[] } {
  return {
    command: "node",
    args: ["--experimental-strip-types", PICKER_SCRIPT, ...args],
  };
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
  // Match patterns that look like path starts — explicit only, no generic word fallback
  const patterns = [
    // ~/... or ~ (tilde path) — allow spaces since we're inside delimiters
    { re: /(~[^"'`]*)$/, group: 1 },
    // ./... or ../... (relative path) — allow spaces
    { re: /((?:\.\.?\/)[^"'`]*)$/, group: 1 },
    // /... (absolute path) — allow spaces
    { re: /(\/[^"'`]*)$/, group: 1 },
  ];

  for (const { re, group } of patterns) {
    const match = textBeforeCursor.match(re);
    if (match) {
      const path = match[group];
      if (path) {
        // `/` at the START of the line is a pi.dev command (e.g. /model, /caveman),
        // NOT a file path. Skip it — absolute paths always have something before them.
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
  const pickerPath = ensurePickerScript();

  // ── Interactive /pick command ──────────────────────────────────
  pi.registerCommand("pick", {
    description: "Browse and select file paths interactively (arrow keys, fuzzy filter). Usage: /pick [starting-path]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pick requires TUI mode.", "error");
        return;
      }

      if (!pickerPath) {
        ctx.ui.notify("path-picker script not found. Reinstall the extension.", "error");
        return;
      }

      const startPath = args.trim() || ".";
      const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
        tui.stop();
        process.stdout.write("\x1b[2J\x1b[H");
        const shell = process.env.SHELL || "/bin/sh";
        const pickCmd = pickerCommand([startPath]);
        spawnSync(pickCmd.command, [...pickCmd.args], {
          stdio: "inherit",
          env: process.env,
        });
        tui.start();
        tui.requestRender(true);
        done(0);
        return { render: () => [], invalidate: () => {} };
      });

      if (exitCode === 0) {
        ctx.ui.notify("Path selected (see output above)", "info");
      }
    },
  });

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
    triggerCharacters: ["~", "/"],

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);

      // ── Outside delimiters ──────────────────────────────────
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        if (!options.force) {
          // Trigger character (~ or /) typed outside delimiters.
          // `/` at start of line → pi.dev command, delegate to native.
          // `/` after space/text → possible path, suppress.
          // `~` → suppress (tilde outside quotes is rare).
          if (textBeforeCursor.startsWith("/")) {
            return current.getSuggestions(lines, cursorLine, cursorCol, options);
          }
          return null;
        }
        // TAB outside delimiters: delegate to native provider
        // so pi.dev command completion works.
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
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

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);

      // Outside delimiters: delegate to the native provider so that
      // pi still calls getSuggestions on TAB for command completion
      // (/model, /caveman). If we return false, pi skips getSuggestions
      // entirely and all TAB-based completion breaks.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }

      // Inside delimiters: always return true so pi re-queries
      // getSuggestions on every keystroke when the menu is open.
      // getSuggestions returns null when there's no path token,
      // which closes the menu. If we returned false here, pi would
      // skip re-querying and the menu would stay open with stale data
      // even after the user deletes the trigger character.
      return true;
    },
  };
}
