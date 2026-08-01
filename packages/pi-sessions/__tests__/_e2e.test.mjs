import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import sessionsExtension from "../index.ts";
import { createMockPi, createMockCtx, makeModel, makeTheme } from "../../../test/harness.mjs";
import { getSessionsDir, clearSessionsCache } from "../lib/_sessions.ts";
import { writeSession, sampleSession, KEY, freshAgentDir } from "./_fixtures.mjs";

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
