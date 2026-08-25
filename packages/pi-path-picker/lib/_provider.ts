/**
 * pi-path-picker - autocomplete provider wrapper
 *
 * Wraps the native provider and adds ~ expansion and path-aware completion
 * inside quoted strings. Private module (underscore prefix).
 */

import { dirname, basename } from "node:path";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { getDelimiterContext, extractPathToken, resolvePath, listPathItems } from "./_helpers.ts";

/**
 * Number of items shown by the first Tab (autocomplete mode). A second Tab
 * on the same token switches to detailed mode and lists every file and
 * directory in the target folder.
 */
const AUTOCOMPLETE_LIMIT = 30;

/**
 * Create an autocomplete provider for file paths.
 * Wraps the built-in provider and adds ~ expansion and path-aware completion.
 */
export function createPathAutocompleteProvider(
  current: AutocompleteProvider,
  cwd: string,
): AutocompleteProvider {
  // Detailed mode: a second Tab on the same token (same line, cursor and
  // path) lists EVERY file and directory in the target folder - hidden files
  // included, no prefix filter, no cap - instead of the capped fuzzy list.
  // Any change to the token (typing, moving the cursor) resets to the
  // regular autocomplete mode on the next Tab.
  let lastSnapshot: string | null = null;
  let detailedMode = false;

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

      // Without cursor-relative quotes the wrapper is transparent.
      if (delimiterContext === "outside") {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      // Una coppia rotta deve chiudere qualsiasi menu senza delegare al nativo.
      if (delimiterContext === "broken") {
        return null;
      }

      // Inside the pair, only Tab (`force`) can activate the path picker.
      if (!options.force || options.signal.aborted) {
        return null;
      }

      const token = extractPathToken(textBeforeCursor);
      if (!token || !token.path.includes("/")) {
        return null;
      }

      // Track Tab presses on the same token: the first Tab opens the capped
      // autocomplete list, a second Tab on the same snapshot switches to
      // detailed mode (every file and directory).
      const snapshot = `${cursorLine}:${cursorCol}:${token.path}`;
      if (lastSnapshot !== snapshot) {
        lastSnapshot = snapshot;
        detailedMode = false;
      } else {
        detailedMode = true;
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

        const items = listPathItems(dirPath, detailedMode ? "" : filePrefix, {
          includeHidden: detailedMode,
        });
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
          // Detailed mode (second Tab) lists everything; the first Tab caps.
          items: detailedMode ? autocompleteItems : autocompleteItems.slice(0, AUTOCOMPLETE_LIMIT),
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

      // If suggestions come from a provider that is not the path picker
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
      // only a null result can immediately close a stale menu.
      return true;
    },
  };
}
