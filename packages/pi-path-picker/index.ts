/**
 * Path Picker Extension - Interactive file path autocomplete
 *
 * Provides:
 * - **Editor autocomplete**: ~/ and /-based path completion with fuzzy filtering
 *   directly in the prompt input field, solo su Tab e dentro backtick/single/double quotes
 * - `/reasoning` command autocomplete: mostra i livelli di thinking disponibili
 *   per il modello corrente dopo `/reasoning ` + SPACE
 *
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

// ── Thinking levels /reasoning support ────────────────────────────

/**
 * Pi thinking levels in canonical order.
 */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Human-readable labels for each thinking level.
 */
const THINKING_LABELS: Record<string, string> = {
  off: "🧠 off",
  minimal: "🧠 minimal",
  low: "🧠 low",
  medium: "🧠 medium",
  high: "🧠 high",
  xhigh: "🧠 xhigh",
  max: "🧠 max",
};

/**
 * Restituisce i suggerimenti per il comando /reasoning.
 * Filtra i livelli in base alle capacità del modello corrente.
 */
function getThinkingLevelSuggestions(
  model: Record<string, unknown> | undefined,
  userPrefix: string,
): AutocompleteSuggestions | null {
  // Determine which levels the model supports
  const supportedLevels = new Set<string>();
  const thinkingLevelMap = model?.thinkingLevelMap as Record<string, unknown> | undefined;

  if (thinkingLevelMap) {
    for (const level of THINKING_LEVELS) {
      if (thinkingLevelMap[level] !== null) {
        supportedLevels.add(level);
      }
    }
  } else {
    // No thinkingLevelMap: assume all levels available
    for (const level of THINKING_LEVELS) {
      supportedLevels.add(level);
    }
  }

  const lowerPrefix = userPrefix.toLowerCase();
  const items: AutocompleteItem[] = [];

  for (const level of THINKING_LEVELS) {
    if (!supportedLevels.has(level)) continue;
    if (lowerPrefix && !level.startsWith(lowerPrefix) && !level.includes(lowerPrefix)) continue;

    const modelLabel = model ? `${model.provider as string}/${model.id as string}` : "current model";
    items.push({
      value: level,
      label: THINKING_LABELS[level] ?? level,
      description: modelLabel,
    });
  }

  if (items.length === 0) return null;

  return {
    prefix: userPrefix,
    items,
  };
}

// ── Extension entry point ─────────────────────────────────────────

export default function pathPickerExtension(pi: ExtensionAPI) {
  // ── Inline path autocomplete nel campo di input TUI ───────
  // Fornisce Tab completion per percorsi ~, / e relativi (./, ../)
  // SOLO dentro apici (", ', `).
  //
  // Aggiunge anche autocomplete per /reasoning + SPACE con i livelli
  // di thinking supportati dal modello corrente.
  pi.on("session_start", async (_event, ctx) => {
    // Riferimento al modello corrente, si aggiorna quando l'utente
    // cambia modello via /model o Ctrl+P
    let currentModel = ctx.model as Record<string, unknown> | undefined;

    pi.on("model_select", async (event) => {
      currentModel = event.model as Record<string, unknown>;
    });

    ctx.ui.addAutocompleteProvider(
      (current: AutocompleteProvider) => createPathAutocompleteProvider(current, ctx.cwd, () => currentModel),
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
  getModel: () => Record<string, unknown> | undefined,
): AutocompleteProvider {
  return {
    // Trigger characters per l'autocomplete. Attivano getSuggestions immediatamente.
    //
    //   `~`   → dentro gli apici: path autocomplete immediato (home directory)
    //   `"` `'` `` ` `` → dentro gli apici: path autocomplete immediato
    //
    // IMPORTANTE: `/` NON è un trigger character perché interferisce con i comandi
    // pi.dev come /model, /caveman. Dentro gli apici, il path autocomplete si attiva
    // comunque via shouldTriggerFileCompletion (TAB) o dopo altri trigger.
    //
    // Fuori dagli apici il provider delega al provider nativo per i comandi slash
    // (/model, /caveman, ecc.) e per @file. L'unica eccezione è /reasoning che
    // viene intercettato per mostrare i livelli di thinking disponibili.
    triggerCharacters: ["~", "\"", "'", "`"],

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);

      // ── Outside delimiters ──────────────────────────────────
      // Quando il cursore è fuori dagli apici, il path picker NON
      // deve mostrare i propri suggerimenti. Tuttavia:
      //
      //   1. /reasoning + SPACE → mostra i livelli di thinking
      //   2. Tutto il resto → delega al provider nativo così che
      //      i comandi slash (/model, /caveman, /reload, ecc.) e
      //      l'autocomplete @file funzionino regolarmente.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        // ── /reasoning command autocomplete ─────────────────
        // Quando l'utente digita /reasoning + SPACE, mostriamo
        // i livelli di thinking supportati dal modello corrente.
        const reasoningMatch = textBeforeCursor.match(/^\/reasoning\s+(.*)$/);
        if (reasoningMatch) {
          const userInput = reasoningMatch[1] ?? "";
          return getThinkingLevelSuggestions(getModel(), userInput);
        }

        // Delegate to the native provider (slash commands, @file, etc.)
        // IMPORTANTE: non ritornare null in questo caso — null dice a pi
        // "nessun suggerimento", il che blocca il provider nativo.
        // Invece, chiamiamo current.getSuggestions() per lasciare che sia
        // il provider sottostante (quello nativo di pi.dev) a gestire il
        // completamento dei comandi slash, @file, argomenti, ecc.
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

      // Se i suggerimenti provengono da un provider che non è il path picker
      // (comandi slash nativi, /reasoning, @file, argomenti comandi, ecc.),
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

      // ── Outside delimiters ────────────────────────────────
      // Se il cursore è fuori dagli apici, il path picker non deve attivarsi.
      // Tuttavia, dobbiamo forzare re-query quando l'utente digita
      // /reasoning + SPACE, così getSuggestions intercetta e mostra i livelli.
      //
      // Per tutto il resto (comandi slash nativi, @file, argomenti), delegamo
      // al provider sottostante tramite current.shouldTriggerFileCompletion.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        // Force re-query per /reasoning command
        if (currentLine.slice(0, cursorCol).match(/^\/reasoning\s/)) {
          return true;
        }
        // Per tutti gli altri casi fuori apici, delegare al provider nativo
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }

      // ── Inside delimiters ─────────────────────────────────
      // Sempre true: forza pi a richiamare getSuggestions a ogni tasto.
      // Returning false farebbe saltare getSuggestions a pi, lasciando il
      // menu aperto con dati stale — la root cause del bug per cui cancellare
      // un carattere di quote NON chiude la lista.
      return true;
    },
  };
}
