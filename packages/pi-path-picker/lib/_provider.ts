/**
 * pi-path-picker - autocomplete provider wrapper
 *
 * Wraps the native provider and adds ~ expansion and path-aware completion
 * inside quoted strings. Private module (underscore prefix).
 *
 * Ownership rule (matches the real pi TUI flow):
 *
 *   - Cursor outside any quote region  -> delegate to the native provider
 *     (slash commands, @file, native Tab completion: untouched).
 *   - Cursor inside a quote region     -> pi-path-picker owns Tab
 *     completion. A region is the text between an opening delimiter and
 *     its closing delimiter; it also includes the natural typing state
 *     (opening quote still open) and the "just closed" state (cursor
 *     immediately after the closing quote), where the path token lives
 *     between the two delimiters.
 *   - Inside a region, only Tab (force) opens the path menu; a non-Tab
 *     request (e.g. the native "@" trigger) delegates, so the built-in
 *     fuzzy attachment completion keeps working inside quotes.
 *   - Inside a region with no path token -> no suggestions, which closes
 *     any stale menu without involving the native provider.
 *
 * What the menu shows follows the token shape:
 *   - directory token (`./`, `./src/`, `~/`) -> COMPLETE listing: every
 *     file and folder, hidden entries included, no cap;
 *   - partial name (`./f`, `./src/ma`) -> prefix-filtered entries
 *     (case-insensitive; hidden entries appear when the prefix starts
 *     with `.`).
 * There is deliberately NO "Tab twice = detailed mode": there is nothing
 * extra to unlock - the pi TUI applies the selected item on the second
 * Tab instead of re-querying, so a state machine keyed on repeated Tab
 * presses can never fire there.
 */

import { dirname, basename } from 'node:path';
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui';
import {
  findQuoteRegion,
  extractPathToken,
  resolvePath,
  listPathItems,
  joinPath,
  type QuoteRegion,
} from './_helpers.ts';

/** Text of the quote region that touches the cursor. */
function regionText(line: string, region: QuoteRegion, col: number): string {
  const end = region.cursorAfterClose ? (region.closing ?? col) : col;

  return line.slice(region.opening + 1, end);
}

/**
 * Resolve the absolute [start, end) range of the path token inside the
 * quote region, or null when the cursor is not inside a region or the
 * region contains no path token.
 */
function tokenRange(line: string, col: number): { token: string; start: number; end: number } | null {
  const region = findQuoteRegion(line, col);

  if (!region) {
    return null;
  }

  const text = regionText(line, region, col);
  const token = extractPathToken(text);

  if (!token) {
    return null;
  }

  return {
    token: token.path,
    start: region.opening + 1 + token.startIndex,
    end: region.cursorAfterClose ? (region.closing ?? col) : col,
  };
}

/**
 * Create an autocomplete provider for file paths.
 * Wraps the built-in provider and adds ~ expansion and path-aware completion.
 */
export function createPathAutocompleteProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
  return {
    // Non aggiunge trigger characters: preserva esclusivamente quelli nativi.
    // Il path picker viene attivato solo da Tab, dentro una regione quotata,
    // quando il token contiene almeno uno slash.
    triggerCharacters: current.triggerCharacters,

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean }
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? '';
      const region = findQuoteRegion(currentLine, cursorCol);

      // With no quoted region under the cursor the wrapper stays transparent.
      if (!region) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      if (options.signal.aborted) {
        return null;
      }

      // Inside a region only Tab (force) activates the path picker. Plain
      // typing, such as a "@" trigger inside the quotes, stays with the
      // native provider, so the existing @"-fuzzy and its triggers are unchanged.
      if (!options.force) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const text = regionText(currentLine, region, cursorCol);
      const token = extractPathToken(text);

      // Nessun token di percorso (o "~" senza slash) chiude eventuali menu
      // aperti, senza passare dal provider nativo.
      if (!token?.path.includes('/')) {
        return null;
      }

      const { path } = token;

      try {
        // What the menu shows depends on the token shape:
        //   - directory token (`./`, `./src/`, `~/.../`)  -> COMPLETE
        //     listing: every file and folder, hidden entries included,
        //     no cap;
        //   - partial name (`./f`, `./src/ma`)  -> filtered list: only
        //     entries matching the typed prefix (case-insensitive);
        //     hidden entries appear when the prefix starts with `.`.
        let dirPath: string;
        let filePrefix: string;

        if (path.endsWith('/') || path === '~') {
          // Directory token: complete contents of that folder
          dirPath = resolvePath(path, cwd);
          filePrefix = '';
        } else {
          // Partial name: parent dir, filtered by the typed prefix
          filePrefix = basename(path);
          const parentDir = dirname(path);

          dirPath = parentDir === '.' ? cwd : resolvePath(parentDir, cwd);
        }

        const items = listPathItems(dirPath, filePrefix, { includeHidden: filePrefix === '' });

        if (items.length === 0 || options.signal.aborted) {
          return null;
        }

        // Convert to autocomplete items
        const autocompleteItems: AutocompleteItem[] = items.map((item) => {
          const suffix = item.isDir ? '/' : '';
          const base = path.endsWith('/') ? path : dirname(path);

          return {
            value: joinPath(base, `${item.name}${suffix}`),
            label: item.isDir ? `📁 ${item.name}/` : `📄 ${item.name}`,
            description: item.isDir ? 'directory' : 'file',
          };
        });

        return {
          items: autocompleteItems,
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
      prefix: string
    ): { lines: string[]; cursorLine: number; cursorCol: number } {
      const currentLine = lines[cursorLine] ?? '';
      const range = tokenRange(currentLine, cursorCol);

      // When the suggestions come from a provider that is not the path picker
      // (native slash commands, @file, command arguments), or the token does
      // not match the suggestion prefix, delegate to the underlying provider
      // with exactly the same arguments.
      if (!range || range.token !== prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

      // Replace exactly the token range; when the pair is closed the
      // closing quote sits at range.end and is preserved.
      const completion = item.value;
      const newLine = currentLine.slice(0, range.start) + completion + currentLine.slice(range.end);

      const newLines = [...lines];

      newLines[cursorLine] = newLine;

      return {
        lines: newLines,
        cursorLine,
        cursorCol: range.start + completion.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const currentLine = lines[cursorLine] ?? '';
      const region = findQuoteRegion(currentLine, cursorCol);

      // Fuori dalla regione preserva esattamente il comportamento nativo.
      if (!region) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }

      // Dentro una regione quotata (aperta, chiusa o appena chiusa) spetta
      // al path picker decidere tramite getSuggestions: only a null result
      // can immediately close a stale menu.
      return true;
    },
  };
}
