#!/usr/bin/env node

/**
 * pick-path.ts — Interactive file path autocomplete
 *
 * Features:
 * - Arrow key navigation (↑ ↓)
 * - Fuzzy + substring filtering as you type
 * - Tab to complete and continue browsing
 * - Enter to select
 * - Directory traversal (select a dir to enter it)
 * - Relative and absolute path output
 *
 * Usage:
 *   node --experimental-strip-types pick-path.ts            # Interactive browser (cwd)
 *   node --experimental-strip-types pick-path.ts --quick *  # First match for glob
 *   echo "src" | node --experimental-strip-types pick-path.ts  # Pipe a starting path
 */

import { readdirSync, statSync } from "node:fs";
import { resolve, relative, sep, basename, dirname, join } from "node:path";
import { homedir } from "node:os";

// ── Config ─────────────────────────────────────────────────────────
const SHOW_HIDDEN: boolean = process.env.PICK_SHOW_HIDDEN === "1";
const MAX_VISIBLE: number = 20;
const FUZZY_THRESHOLD: number = 0.3;

// ── Types ──────────────────────────────────────────────────────────

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

interface ScoredItem {
  item: FileItem;
  score: number;
}

// ── Glob matching (simple implementation) ──────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Find files matching a glob pattern using recursive directory traversal.
 */
function globFiles(rootDir: string, pattern: string): string[] {
  const regex = globToRegex(pattern);
  const results: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (!SHOW_HIDDEN && entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      const relPath = relative(rootDir, fullPath);
      if (regex.test(relPath)) results.push(fullPath);
      try {
        if (statSync(fullPath).isDirectory()) walk(fullPath);
      } catch { /* skip */ }
    }
  };

  walk(rootDir);
  return results;
}

/**
 * List directory contents.
 */
function listDir(dirPath: string): FileItem[] {
  try {
    const entries = readdirSync(dirPath);
    const items: FileItem[] = [];
    for (const entry of entries) {
      if (!SHOW_HIDDEN && entry.startsWith(".")) continue;
      const full = join(dirPath, entry);
      try {
        const s = statSync(full);
        items.push({
          name: entry,
          path: full,
          isDir: s.isDirectory(),
          size: s.size,
          mtime: s.mtimeMs,
        });
      } catch { /* skip */ }
    }
    // Sort: dirs first, then by name
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  } catch {
    return [];
  }
}

/**
 * Fuzzy match score (simple implementation).
 * Returns 0-1 where 1 = perfect match.
 */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (t === q) return 1;
  if (t.startsWith(q)) return 0.9;

  // Substring match
  if (t.includes(q)) return 0.7;

  // Character-by-character fuzzy (query chars appear in order in text)
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length) return 0.5 + (q.length / Math.max(t.length, 1)) * 0.3;

  return 0;
}

/**
 * Filter items by query string (fuzzy + substring).
 */
function filterItems(items: FileItem[], query: string): FileItem[] {
  if (!query) return items;
  const scored: ScoredItem[] = items.map(item => ({
    item,
    score: Math.max(
      fuzzyScore(query, item.name),
    ),
  }));
  return scored
    .filter(s => s.score >= FUZZY_THRESHOLD)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.item.name.localeCompare(b.item.name);
    })
    .map(s => s.item);
}

// ── Interactive Mode ───────────────────────────────────────────────

/**
 * Render the picker UI and handle keyboard input.
 * Returns the selected path or null.
 */
async function interactivePick(startDir: string): Promise<string | null> {
  let currentDir = resolve(startDir || ".");
  let query = "";
  let selectedIndex = 0;
  let scrollOffset = 0;

  // Get initial items
  let allItems = listDir(currentDir);

  return new Promise<string | null>((resolvePick) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Save terminal state
    try {
      stdin.setRawMode(true);
    } catch { /* not a TTY */ }
    stdin.resume();
    stdin.setEncoding("utf8");

    // ── Render ──────────────────────────────────────────────────
    function render(): void {
      const filtered = query ? filterItems(allItems, query) : allItems;
      const total = filtered.length;
      const displayItems = filtered.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

      // Build output
      const lines: string[] = [];

      // Title bar
      const dir = currentDir.replace(homedir(), "~");
      lines.push(`\x1b[36m📁 ${dir}\x1b[0m`);
      lines.push(`\x1b[90m${query ? `🔍 ${query}` : "Type to filter  ↑↓ navigate  ↵ select  ⭾ browse  ⎋ cancel"}\x1b[0m`);
      lines.push("");

      // Items
      if (total === 0) {
        lines.push("  \x1b[90m(no matches)\x1b[0m");
      } else {
        for (let i = 0; i < displayItems.length; i++) {
          const item = displayItems[i];
          const idx = scrollOffset + i;
          const prefix = idx === selectedIndex ? "\x1b[7m" : " ";
          const suffix = idx === selectedIndex ? "\x1b[0m" : " ";
          const icon = item.isDir ? "📁" : (item.name.match(/\.(js|ts|jsx|tsx|json|md|css|html)$/i) ? "📄" : "📎");
          lines.push(`${prefix} ${icon} ${item.name}${suffix}`);
        }
      }

      // Footer with count
      if (total > 0) {
        lines.push("");
        lines.push(`\x1b[90m${selectedIndex + 1}/${total} items\x1b[0m`);
      }

      // Clear and render
      stdout.write("\x1b[2J\x1b[H" + lines.join("\n"));
    }

    // ── Input handler ───────────────────────────────────────────
    function onData(data: string): void {
      const bytes = Buffer.from(data, "utf8");

      // Escape sequences
      if (bytes[0] === 0x1b && bytes[1] === 0x5b) {
        switch (bytes[2]) {
          case 0x41: // ↑
            selectedIndex = Math.max(0, selectedIndex - 1);
            if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
            render();
            return;
          case 0x42: // ↓
            selectedIndex = Math.min(
              filterItems(allItems, query).length - 1,
              selectedIndex + 1
            );
            if (selectedIndex >= scrollOffset + MAX_VISIBLE) {
              scrollOffset = selectedIndex - MAX_VISIBLE + 1;
            }
            render();
            return;
          case 0x43: // →
            handleEnter(true);
            return;
          case 0x44: // ←
            goUp();
            return;
        }
        return;
      }

      // Tab
      if (bytes[0] === 0x09) {
        handleEnter(true);
        return;
      }

      // Enter
      if (bytes[0] === 0x0d || bytes[0] === 0x0a) {
        handleEnter(false);
        return;
      }

      // Backspace / Delete
      if (bytes[0] === 0x7f || bytes[0] === 0x08) {
        query = query.slice(0, -1);
        selectedIndex = 0;
        scrollOffset = 0;
        render();
        return;
      }

      // Esc
      if (bytes[0] === 0x1b && data.length === 1) {
        cleanup(null);
        return;
      }

      // Printable characters
      const char = data.toString();
      if (char.length === 1 && char >= " ") {
        query += char;
        selectedIndex = 0;
        scrollOffset = 0;
        render();
      }
    }

    function goUp(): void {
      const parent = dirname(currentDir);
      if (parent !== currentDir) {
        currentDir = parent;
        allItems = listDir(currentDir);
        query = "";
        selectedIndex = 0;
        scrollOffset = 0;
        render();
      }
    }

    function handleEnter(browseInto: boolean): void {
      const filtered = filterItems(allItems, query);
      const selected = filtered[selectedIndex];

      if (!selected) return;

      if (selected.isDir && browseInto) {
        // Enter directory
        currentDir = selected.path;
        allItems = listDir(currentDir);
        query = "";
        selectedIndex = 0;
        scrollOffset = 0;
        render();
      } else if (selected.isDir && !browseInto) {
        // Select directory
        cleanup(selected.path);
      } else {
        // Select file
        cleanup(selected.path);
      }
    }

    function cleanup(result: string | null): void {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\x1b[2J\x1b[H");
      resolvePick(result);
    }

    stdin.on("data", onData);
    render();
  });
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isQuick = args.includes("--quick");
  const quickArgs = isQuick ? args.filter((a: string) => a !== "--quick") : args;

  // Quick mode with glob pattern
  if (isQuick) {
    const pattern = quickArgs[0] || "**/*";
    const results = globFiles(".", pattern);
    console.log(results.join("\n"));
    process.exit(0);
  }

  // Determine starting path
  let startPath = ".";

  // Check for piped input
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const piped = Buffer.concat(chunks).toString().trim();
    if (piped) startPath = piped;
  } else if (quickArgs.length > 0) {
    startPath = quickArgs[0];
  }

  // Resolve starting path
  if (startPath.startsWith("~")) {
    startPath = join(homedir(), startPath.slice(1));
  }
  startPath = resolve(startPath);

  // Interactive mode
  const selected = await interactivePick(startPath);

  if (selected) {
    // Output relative path if possible
    try {
      const rel = relative(process.cwd(), selected);
      console.log(rel || ".");
    } catch {
      console.log(selected);
    }
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error("Error:", err.message);
  process.exit(1);
});
