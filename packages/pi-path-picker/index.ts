/**
 * Path Picker Extension - Interactive file path autocomplete
 *
 * Provides:
 * - **Editor autocomplete**: ~/ and /-based path completion with fuzzy filtering
 *   directly in the prompt input field, solo su Tab e dentro backtick/single/double quotes
 * Features:
 * - Fuzzy text filter as you type
 * - Tab to enter directories, Enter to select
 * - Inline `~` expansion and path autocomplete in the input field
 * - Comandi slash nativi (/model, /caveman, ecc.) non vengono intercettati
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
 * Delimitatori supportati dal path autocomplete.
 */
const STRING_DELIMITERS = ['"', "'", "`"] as const;
type DelimiterContext = "inside" | "broken" | "outside";

/**
 * Un carattere è escaped solo con un numero dispari di backslash consecutivi.
 */
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
function getDelimiterContext(line: string, col: number): DelimiterContext {
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

// ── Extension entry point ─────────────────────────────────────────

export default function pathPickerExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider(
      (current: AutocompleteProvider) => createPathAutocompleteProvider(current, ctx.cwd),
    );
  });
}

/**
 * Create an autocomplete provider for file paths.
 * Wraps the built-in provider and adds ~ expansion and path-aware completion.
 */
function createPathAutocompleteProvider(
  current: AutocompleteProvider,
  cwd: string,
): AutocompleteProvider {
  return {
    // Non aggiunge trigger characters: preserva esclusivamente quelli nativi.
    // Il path picker viene attivato solo da Tab, dentro una coppia valida,
    // quando il token contiene almeno uno slash.
    triggerCharacters: current.triggerCharacters,

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const delimiterContext = getDelimiterContext(currentLine, cursorCol);

      // Senza quote relative al cursore il wrapper è trasparente.
      if (delimiterContext === "outside") {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      // Una coppia rotta deve chiudere qualsiasi menu senza delegare al nativo.
      if (delimiterContext === "broken") {
        return null;
      }

      // Dentro la coppia, solo Tab (`force`) può attivare il path picker.
      if (!options.force || options.signal.aborted) {
        return null;
      }

      const token = extractPathToken(textBeforeCursor);
      if (!token || !token.path.includes("/")) {
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
      const token = getDelimiterContext(currentLine, cursorCol) === "inside" ? extractPathToken(textBeforeCursor) : null;

      // Se i suggerimenti provengono da un provider che non è il path picker
      // (comandi slash nativi, @file, argomenti comandi, ecc.),
      // deleghiamo al provider sottostante.
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
      const delimiterContext = getDelimiterContext(currentLine, cursorCol);

      // Fuori dalla coppia preserva esattamente il comportamento nativo.
      if (delimiterContext === "outside") {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }

      // Dentro una coppia valida o rotta richiama getSuggestions:
      // solo un risultato null può chiudere immediatamente un menu stale.
      return true;
    },
  };
}
