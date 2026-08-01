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

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the sessions directory in a temp agent dir
const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-sessions-test-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

import sessionsExtension, {
  autoNameSession,
  parseSessionFile,
  formatDate,
  groupSessionsByFolder,
  getSessionsDir,
  clearSessionsCache,
  SessionSidebarComponent,
  FolderSidebarComponent,
} from "./index.ts";
import { createMockPi, createMockCtx, makeModel, makeTheme } from "../../test/harness.mjs";

const KEY = { escape: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B", home: "\x1b[H", end: "\x1b[F", pageUp: "\x1b[5~", pageDown: "\x1b[6~", backspace: "\x7f", ctrlC: "\x03" };

// ── Test fixtures ─────────────────────────────────────────────────

function freshAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "pi-sessions-sub-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  clearSessionsCache();
  return dir;
}

function writeSession(project, file, lines) {
  const dir = join(getSessionsDir(), project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), lines.map((l) => JSON.stringify(l)).join("\n"));
}

function sampleSession(overrides = {}) {
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

// ── Unit: autoNameSession ─────────────────────────────────────────

test("autoNameSession: string content is cleaned and truncated", () => {
  assert.equal(autoNameSession("   hello    world  "), "hello world");
  const long = "a".repeat(100);
  const named = autoNameSession(long);
  assert.equal(named.length, 60);
  assert.ok(named.endsWith("..."));
});

test("autoNameSession: text blocks from content arrays", () => {
  assert.equal(
    autoNameSession([{ type: "text", text: "Refactor login" }, { type: "image", url: "x" }]),
    "Refactor login",
  );
});

test("autoNameSession: empty or non-text content → Empty session", () => {
  assert.equal(autoNameSession(undefined), "Empty session");
  assert.equal(autoNameSession(""), "Empty session");
  assert.equal(autoNameSession([{ type: "toolUse", name: "x" }]), "Empty session");
  assert.equal(autoNameSession(42), "Empty session");
});

// ── Unit: parseSessionFile ────────────────────────────────────────

test("parseSessionFile: extracts name, model, provider, cwd and counts", () => {
  const file = join(getSessionsDir(), "proj", "s.jsonl");
  mkdirSync(join(getSessionsDir(), "proj"), { recursive: true });
  writeFileSync(
    file,
    [
      { type: "session", cwd: "/home/dev/app", timestamp: "2026-07-01T10:00:00Z" },
      { type: "message", message: { role: "user", content: "Fix login bug" } },
      { type: "message", message: { role: "assistant", content: "On it", model: "claude-opus-4", provider: "anthropic" } },
      { type: "message", message: { role: "tool", content: "" } },
    ].map((l) => JSON.stringify(l)).join("\n"),
  );
  const s = parseSessionFile(file);
  assert.equal(s.name, "Fix login bug");
  assert.equal(s.cwd, "/home/dev/app");
  assert.equal(s.model, "claude-opus-4");
  assert.equal(s.provider, "anthropic");
  assert.equal(s.messageCount, 2, "only user+assistant counted");
});

test("parseSessionFile: malformed lines are skipped, missing file → null", () => {
  const file = join(getSessionsDir(), "proj2", "s.jsonl");
  mkdirSync(join(getSessionsDir(), "proj2"), { recursive: true });
  writeFileSync(file, "not json\n{ \"type\": \"message\", \"message\": { \"role\": \"user\", \"content\": \"Hi\" } }\n");
  const s = parseSessionFile(file);
  assert.equal(s.name, "Hi");
  assert.equal(parseSessionFile(join(getSessionsDir(), "missing.jsonl")), null);
});

// ── Unit: formatDate ──────────────────────────────────────────────

test("formatDate: invalid input → empty string", () => {
  assert.equal(formatDate("garbage"), "");
  assert.equal(formatDate(""), "");
});

test("formatDate: normalizes timestamps without timezone to UTC", () => {
  const now = new Date();
  const iso = now.toISOString().slice(0, 19); // no Z
  assert.ok(formatDate(iso).length > 0);
});

test("formatDate: yesterday / older-than-week buckets", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  assert.equal(formatDate(yesterday), "Yesterday");
  const threeDays = new Date(Date.now() - 3 * 86400000).toISOString();
  assert.match(formatDate(threeDays), /^\d+d ago$/);
});

// ── Unit: groupSessionsByFolder ───────────────────────────────────

test("groupSessionsByFolder: groups by cwd and sorts folders newest first", () => {
  const a = sampleSession({ cwd: "/a", date: "2026-07-01T00:00:00Z", mtime: 1, messageCount: 2 });
  const b = sampleSession({ cwd: "/b", date: "2026-08-01T00:00:00Z", mtime: 3, messageCount: 5 });
  const c = sampleSession({ cwd: "/a", date: "2026-07-02T00:00:00Z", mtime: 2, messageCount: 1 });
  const folders = groupSessionsByFolder([a, b, c]);
  assert.equal(folders.length, 2);
  assert.equal(folders[0].folder, "/b", "newest folder first");
  assert.equal(folders[0].sessionCount, 1);
  assert.equal(folders[0].totalMessages, 5);
  assert.equal(folders[1].folder, "/a");
  assert.equal(folders[1].sessionCount, 2);
  assert.equal(folders[1].totalMessages, 3);
});

// ── Unit: listSessions (isolated dir) ─────────────────────────────

test("listSessions: reads nested project dirs, newest first", async () => {
  freshAgentDir(); // isolate from other tests' session files
  writeSession("projA", "1.jsonl", [
    { type: "session", cwd: "/a", timestamp: "2026-07-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "older session" } },
  ]);
  writeSession("projB", "2.jsonl", [
    { type: "session", cwd: "/b", timestamp: "2026-08-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "newer session" } },
  ]);
  const fs = await import("node:fs");
  const now = new Date();
  fs.utimesSync(join(getSessionsDir(), "projB", "2.jsonl"), now, now);
  fs.utimesSync(join(getSessionsDir(), "projA", "1.jsonl"), new Date(now - 10000), new Date(now - 10000));
  const sessions = (await import("./index.ts")).listSessions();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].name, "newer session", "newest first");
});

// ── Component: SessionSidebarComponent ────────────────────────────

function makeSidebar(sessions, done) {
  return new SessionSidebarComponent(makeTheme(), sessions, done, 30);
}

test("session sidebar: escape closes with undefined", () => {
  let result = "unset";
  const sb = makeSidebar([sampleSession()], (r) => (result = r));
  sb.handleInput(KEY.escape);
  assert.equal(result, undefined);
});

test("session sidebar: enter selects the first session", () => {
  const sessions = [sampleSession({ name: "First" }), sampleSession({ name: "Second", file: "/y" })];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.enter);
  assert.equal(result, sessions[0]);
});

test("session sidebar: typing filters and enter selects the match", () => {
  const sessions = [
    sampleSession({ name: "Refactor auth", file: "/a" }),
    sampleSession({ name: "Add tests", file: "/b" }),
  ];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput("a");
  sb.handleInput("u"); // query "au" matches only "Refactor auth"
  sb.handleInput(KEY.enter);
  assert.equal(result?.file, "/a");
});

test("session sidebar: up/down navigation selects other entries", () => {
  const sessions = [sampleSession({ name: "A", file: "/a" }), sampleSession({ name: "B", file: "/b" }), sampleSession({ name: "C", file: "/c" })];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.down);
  sb.handleInput(KEY.down);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/c");
  sb.handleInput(KEY.up);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/b");
});

test("session sidebar: backspace removes filter chars, ctrl+c closes", () => {
  const sessions = [sampleSession()];
  let result = "unset";
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput("x");
  sb.handleInput(KEY.backspace);
  sb.handleInput(KEY.enter); // filter cleared → first session selected
  assert.equal(result, sessions[0]);
  sb.handleInput(KEY.ctrlC);
  assert.equal(result, undefined);
});

test("session sidebar: home/end and page navigation", () => {
  const sessions = Array.from({ length: 15 }, (_, i) => sampleSession({ name: `S${i}`, file: `/f${i}` }));
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.end);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/f14");
  sb.handleInput(KEY.home);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/f0");
  sb.handleInput(KEY.pageDown);
  sb.handleInput(KEY.pageDown);
  sb.handleInput(KEY.enter);
  assert.ok(result.file !== "/f0", "pageDown moves selection");
});

test("session sidebar: render shows folder, message and no-results state", () => {
  const sb = makeSidebar([sampleSession({ cwd: "/home/dev/app", lastUserMessage: "Visible message" })], () => {});
  const lines = sb.render(60).join("\n");
  assert.ok(lines.includes("/home/dev/app"), "folder path rendered");
  assert.ok(lines.includes("Visible message"), "last user message rendered");
  const empty = makeSidebar([], () => {});
  assert.ok(empty.render(60).join("\n").includes("No sessions found"));
});

test("folder sidebar: renders and selects on enter", () => {
  let result;
  const folders = [{ folder: "/home/dev/app", sessions: [sampleSession()], sessionCount: 1, totalMessages: 3, latestDate: "2026-08-01T00:00:00Z", latestModel: "claude" }];
  const fb = new FolderSidebarComponent(makeTheme(), folders, (r) => (result = r), 30);
  const lines = fb.render(60).join("\n");
  assert.ok(lines.includes("/home/dev/app"));
  fb.handleInput(KEY.enter);
  assert.equal(result, folders[0]);
  fb.handleInput(KEY.escape);
  assert.equal(result, undefined);
});

// ── E2E: extension registration ───────────────────────────────────

test("registers /sessions, /projects and session_start", () => {
  const { pi, handlers, commands } = createMockPi();
  sessionsExtension(pi);
  assert.ok(handlers.get("session_start")?.length);
  assert.ok(commands.has("sessions"));
  assert.ok(commands.has("projects"));
});

test("session_start: auto-names the session from the first user message", async () => {
  const { pi, emit, calls, state } = createMockPi();
  sessionsExtension(pi);
  const entries = [
    { type: "message", message: { role: "user", content: "Deploy the new dashboard" } },
  ];
  const ctx = createMockCtx({ sessionManager: { getEntries: () => entries, getBranch: () => [] } });
  await emit("session_start", {}, ctx);
  assert.equal(state.sessionName, "Deploy the new dashboard");
});

test("session_start: keeps an existing session name", async () => {
  const { pi, emit, calls, state } = createMockPi();
  state.sessionName = "Already named";
  sessionsExtension(pi);
  const ctx = createMockCtx({ sessionManager: { getEntries: () => [{ type: "message", message: { role: "user", content: "New content" } }], getBranch: () => [] } });
  await emit("session_start", {}, ctx);
  assert.equal(state.sessionName, "Already named");
  assert.equal(calls.setSessionName.length, 0);
});

test("session_start: empty user message is not set as name", async () => {
  const { pi, emit, calls } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx({ sessionManager: { getEntries: () => [{ type: "message", message: { role: "user", content: "" } }], getBranch: () => [] } });
  await emit("session_start", {}, ctx);
  assert.equal(calls.setSessionName.length, 0);
});

// ── E2E: /sessions command ────────────────────────────────────────

test("/sessions: non-tui mode notifies error", async () => {
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx({ mode: "headless" });
  await runCommand("sessions", "", ctx);
  assert.ok(ctx.ui._uiCalls.some(([c, , t]) => c === "notify" && t === "error"));
});

test("/sessions: no sessions notifies info", async () => {
  freshAgentDir(); // empty sessions dir for this test
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx();
  await runCommand("sessions", "", ctx);
  assert.ok(ctx.ui._uiCalls.some(([c, m]) => c === "notify" && /No sessions found/i.test(m)));
});

test("/sessions: opens the sidebar overlay and restores a selected session", async () => {
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  writeSession("projA", "s1.jsonl", [
    { type: "session", cwd: "/home/dev/app", timestamp: "2026-07-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "Ship the feature" } },
    { type: "message", message: { role: "assistant", content: "ok", model: "claude-opus-4", provider: "anthropic" } },
  ]);
  clearSessionsCache();

  const ctx = createMockCtx();
  let capturedFactory;
  ctx.ui.custom = async (factory, opts) => {
    capturedFactory = factory;
    // simulate the user picking the only session
    return { file: join(getSessionsDir(), "projA", "s1.jsonl"), name: "Ship the feature" };
  };
  const switched = [];
  ctx.switchSession = async (file) => {
    switched.push(file);
    return { cancelled: false };
  };

  await runCommand("sessions", "", ctx);
  assert.ok(capturedFactory, "must open the sidebar overlay");
  const component = capturedFactory(
    { requestRender() {}, terminal: { rows: 30 } },
    makeTheme(),
    {},
    () => {},
  );
  assert.ok(component.render(60).join("\n").includes("Ship the feature"));
  assert.equal(switched.length, 1);
  assert.ok(switched[0].endsWith("s1.jsonl"));
});

test("/projects: opens folder sidebar and drills down to a session", async () => {
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  writeSession("projB", "s2.jsonl", [
    { type: "session", cwd: "/home/dev/other", timestamp: "2026-07-02T00:00:00Z" },
    { type: "message", message: { role: "user", content: "Fix pipeline" } },
  ]);
  clearSessionsCache();

  const ctx = createMockCtx();
  let calls = 0;
  const switched = [];
  ctx.ui.custom = async (factory) => {
    calls++;
    // 1st call: folder picker → returns a folder; 2nd call: session picker → returns a session
    if (calls === 1) {
      return { folder: "/home/dev/other", sessions: [], sessionCount: 1, totalMessages: 1, latestDate: "2026-07-02T00:00:00Z" };
    }
    return { file: join(getSessionsDir(), "projB", "s2.jsonl"), name: "Fix pipeline" };
  };
  ctx.switchSession = async (file) => {
    switched.push(file);
    return { cancelled: false };
  };
  await runCommand("projects", "", ctx);
  assert.equal(switched.length, 1);
  assert.ok(switched[0].endsWith("s2.jsonl"));
});

test("/projects: escape from folder list exits", async () => {
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx();
  ctx.ui.custom = async () => undefined; // Esc → no selection
  await runCommand("projects", "", ctx);
  assert.ok(true, "exits cleanly without crashing");
});
