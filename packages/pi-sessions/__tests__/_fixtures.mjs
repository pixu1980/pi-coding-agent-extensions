/**
 * pi-sessions — unit + e2e test suite
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * - Unit: session naming, JSONL parsing, date formatting, folder grouping,
 *   file listing (isolated under PI_CODING_AGENT_DIR temp dir)
 * - Component: keyboard navigation + rendering of Session/Folder sidebars
 * - E2E: extension factory — /sessions & /projects commands, auto-naming on
 *   session_start, restore flow via ctx.switchSession
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the sessions directory in a temp agent dir
const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-sessions-test-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

import { getSessionsDir, clearSessionsCache } from "../lib/_sessions.ts";
export { makeTheme } from "../../../test/harness.mjs";

export const KEY = { escape: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B", home: "\x1b[H", end: "\x1b[F", pageUp: "\x1b[5~", pageDown: "\x1b[6~", backspace: "\x7f", ctrlC: "\x03" };

// ── Test fixtures ─────────────────────────────────────────────────

export function freshAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-sub-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  clearSessionsCache();
  return dir;
}

export function writeSession(project, file, lines) {
  const dir = join(getSessionsDir(), project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), lines.map((l) => JSON.stringify(l)).join("\n"));
}

export function sampleSession(overrides = {}) {
  return {
    file: "/x/session.jsonl",
    name: "Fix the bug",
    date: new Date().toISOString(),
    messageCount: 3,
    model: "anthropic/claude-opus-4",
    provider: "anthropic",
    cwd: "/home/dev/app",
    mtime: Date.now(),
    lastUserMessage: "Fix the bug",
    ...overrides,
  };
}

