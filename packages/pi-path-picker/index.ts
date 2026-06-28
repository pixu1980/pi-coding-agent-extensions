/**
 * Path Picker Extension — Interactive file path autocomplete
 *
 * Provides:
 * - `/pick` command: interactive path browser with arrow keys
 * - `path_pick` tool: programmatic path autocomplete for the LLM
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

import { spawnSync, execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep, basename, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI, AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

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
        ctx.ui.notify("/pick requires TUI mode. Use the path_pick tool instead.", "error");
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

  // ── path_pick tool for the LLM ─────────────────────────────────
  if (pickerPath) {
    pi.registerTool({
      name: "path_pick",
      label: "Path Picker",
      description:
        "Autocomplete file paths in the project. Use when you need to find files by partial name, glob pattern, or browse directories. Returns matching paths.",
      promptSnippet: "Find or autocomplete file paths",
      promptGuidelines: [
        "Use path_pick when the user asks you to find, open, or reference a file but the exact path is unclear.",
        "Use path_pick to resolve glob patterns like '**/*.test.js' into concrete file paths.",
        "Pass the query parameter with partial filename, directory, or glob pattern.",
      ],
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description:
              "Partial filename, directory path, or glob pattern (e.g. 'button', 'src/components', '**/*.test.js'). Omit to list current directory.",
          }),
        ),
        root: Type.Optional(
          Type.String({
            description: "Root directory to search from (default: project root / current working directory).",
          }),
        ),
        maxResults: Type.Optional(
          Type.Number({
            description: "Maximum number of results (default: 20, max: 100).",
            defaultValue: 20,
          }),
        ),
        mode: StringEnum(["fuzzy", "glob"] as const, {
          description: "'fuzzy' matches partial names (default), 'glob' matches **/*.js patterns.",
          defaultValue: "fuzzy",
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const query = params.query || "";
        const root = params.root || ".";
        const maxResults = Math.min(params.maxResults ?? 20, 100);
        const mode = params.mode || "fuzzy";
        const resolvedRoot = resolve(root);
        let results: string[] = [];

        if (mode === "glob" && query) {
          const pickCmd = pickerCommand(["--quick", query]);
          const output = execSync(`${pickCmd.command} ${pickCmd.args.map(a => `"${a}"`).join(" ")}`, {
            cwd: resolvedRoot,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
          });
          results = output.trim().split("\n").filter(Boolean);
        } else {
          const searchPattern = query ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : ".";
          const cmd = query
            ? `find "${resolvedRoot}" -maxdepth 4 -type f -iname "*${searchPattern}*" 2>/dev/null | head -${maxResults + 10}`
            : `ls -1 "${resolvedRoot}" 2>/dev/null | head -${maxResults + 10}`;

          const output = execSync(cmd, {
            cwd: resolvedRoot,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
          });
          results = output.trim().split("\n").filter(Boolean);

          if (!query) {
            const dirs = execSync(`ls -1d "${resolvedRoot}/"*/ 2>/dev/null || true`, {
              cwd: resolvedRoot,
              encoding: "utf-8",
            });
            const dirList = dirs.trim().split("\n").filter(Boolean).map((d: string) => d.replace(/\/$/, ""));
            results = [...dirList, ...results];
          }
        }

        results = [...new Set(results)].slice(0, maxResults);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No files found matching "${query || "(all files)"}" in ${resolvedRoot}`,
              },
            ],
            details: { total: 0, root: resolvedRoot },
          };
        }

        const list = results.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Found ${results.length} matching paths in ${resolvedRoot}:\n\n${list}`,
            },
          ],
          details: { total: results.length, root: resolvedRoot, paths: results },
        };
      },
    });
  }

  // ── Inject path_pick hint into system prompt for path questions ─
  pi.on("before_agent_start", async (event, _ctx) => {
    const prompt = event.prompt.toLowerCase();
    const pathKeywords = ["find file", "where is", "locate", "path of", "what file", "autocomplete path"];

    if (pathKeywords.some((kw) => prompt.includes(kw))) {
      return {
        systemPrompt:
          event.systemPrompt +
          `\n\n## Path Resolution Note\nWhen the user asks about file paths or you need to find files, use the \`path_pick\` tool to autocomplete paths. Pass partial filenames or directory names as the \`query\` parameter. This is more reliable than guessing paths.`,
      };
    }
  });
}

/**
 * Create an autocomplete provider for file paths.
 * Wraps the built-in provider and adds ~ expansion and path-aware completion.
 */
function createPathAutocompleteProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
  return {
    triggerCharacters: ["~", "/"],

    async getSuggestions(
      lines: string[],
      cursorLine: number,
      cursorCol: number,
      options: { signal: AbortSignal; force?: boolean },
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);

      // The path picker should do its work only when pi's editor requests forced
      // completion (Tab). Natural slash-command autocomplete outside strings is
      // delegated to pi; natural path autocomplete inside strings is suppressed.
      if (!options.force) {
        if (cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
          return null;
        }
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      // NEVER interfere outside delimited strings (backtick, double quote, single quote).
      // Delegate so native pi.dev slash commands and built-in completion keep working.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      // Extract path token (only ~, /, ./ patterns inside delimiters)
      const token = extractPathToken(textBeforeCursor);
      if (!token) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const { path } = token;
      if (options.signal.aborted) return null;

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
          // If parent is empty, use cwd; if ~/..., expand
          const resolvedParent = parentDir === "." ? cwd : resolvePath(parentDir, cwd);
          dirPath = resolvedParent;
        }

        const items = listPathItems(dirPath, filePrefix);
        if (items.length === 0 || options.signal.aborted) {
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
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
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
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

      // Outside delimited strings, preserve native pi.dev Tab behavior.
      if (!cursorInsideAllowedDelimiters(currentLine, cursorCol)) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      }

      // Inside delimiters, the extension triggers only for explicit path tokens.
      return extractPathToken(textBeforeCursor) !== null;
    },
  };
}
