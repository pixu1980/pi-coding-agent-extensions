import test from "node:test";
import assert from "node:assert/strict";
import sessionsExtension from "../index.ts";
import { createMockPi, createMockCtx, makeTheme } from "../../../test/harness.mjs";
import { clearSessionsCache } from "../lib/_sessions.ts";
import { writeSession, KEY, freshAgentDir } from "./_fixtures.mjs";

const MCP_STYLE_MODAL_OPTIONS = {
  overlay: true,
  overlayOptions: { anchor: "center", width: 82 },
};

function installModalDriver(ctx) {
  const modals = [];

  ctx.ui.custom = (factory, options) =>
    new Promise((resolve) => {
      let component;
      let interactionQueued = false;
      const renders = [];
      const interactWhenReady = () => {
        if (!component || interactionQueued) return;
        const text = component.render(82).join("\n");
        renders.push(text);
        if (/Loading (sessions|projects)/i.test(text)) return;

        interactionQueued = true;
        queueMicrotask(() => {
          if (/No sessions found|Error loading/i.test(text)) {
            component.handleInput(KEY.escape);
          } else {
            component.handleInput(KEY.enter);
          }
        });
      };
      const tui = {
        terminal: { rows: 30 },
        requestRender: interactWhenReady,
      };

      component = factory(tui, makeTheme(), {}, resolve);
      modals.push({ component, options, renders, initialText: component.render(82).join("\n") });
      interactWhenReady();
    });

  return modals;
}

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

test("/sessions: empty history is shown inside a centered modal", async () => {
  freshAgentDir();
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx();
  const modals = installModalDriver(ctx);

  await runCommand("sessions", "", ctx);

  assert.equal(modals.length, 1);
  assert.deepEqual(modals[0].options, MCP_STYLE_MODAL_OPTIONS);
  assert.match(modals[0].initialText, /Loading sessions/i);
  assert.ok(modals[0].renders.some((text) => /No sessions found/i.test(text)));
  assert.ok(
    !ctx.ui._uiCalls.some(([call, message]) => call === "notify" && /Loading sessions/i.test(message)),
    "loading state must not leak into the transcript",
  );
});

test("/sessions: loads and restores from one MCP-style centered modal", async () => {
  freshAgentDir();
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  writeSession("projA", "s1.jsonl", [
    { type: "session", id: "session-a", cwd: "/home/dev/app", timestamp: "2026-07-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "Ship the feature" } },
    { type: "message", message: { role: "assistant", content: "ok", model: "claude-opus-4", provider: "anthropic" } },
  ]);
  clearSessionsCache();

  const ctx = createMockCtx();
  const modals = installModalDriver(ctx);
  const switched = [];
  ctx.switchSession = async (file) => {
    switched.push(file);
    return { cancelled: false };
  };

  await runCommand("sessions", "", ctx);

  assert.equal(modals.length, 1, "loading and selection should share one modal");
  assert.deepEqual(modals[0].options, MCP_STYLE_MODAL_OPTIONS);
  assert.match(modals[0].initialText, /Loading sessions/i);
  assert.ok(modals[0].renders.some((text) => text.includes("Ship the feature")));
  assert.equal(switched.length, 1);
  assert.ok(switched[0].endsWith("s1.jsonl"));
  assert.ok(
    !ctx.ui._uiCalls.some(([call, message]) => call === "notify" && /Loading session/i.test(message)),
    "loading state must stay inside the modal",
  );
});

test("/projects: loads in a centered modal and drills down in the same style", async () => {
  freshAgentDir();
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  writeSession("projB", "s2.jsonl", [
    { type: "session", id: "session-b", cwd: "/home/dev/other", timestamp: "2026-07-02T00:00:00Z" },
    { type: "message", message: { role: "user", content: "Fix pipeline" } },
  ]);
  clearSessionsCache();

  const ctx = createMockCtx();
  const modals = installModalDriver(ctx);
  const switched = [];
  ctx.switchSession = async (file) => {
    switched.push(file);
    return { cancelled: false };
  };

  await runCommand("projects", "", ctx);

  assert.equal(modals.length, 2, "project picker and drill-down each use a modal");
  for (const modal of modals) {
    assert.deepEqual(modal.options, MCP_STYLE_MODAL_OPTIONS);
  }
  assert.match(modals[0].initialText, /Loading projects/i);
  assert.ok(modals[0].renders.some((text) => text.includes("/home/dev/other")));
  assert.ok(modals[1].renders.some((text) => text.includes("Fix pipeline")));
  assert.equal(switched.length, 1);
  assert.ok(switched[0].endsWith("s2.jsonl"));
  assert.ok(
    !ctx.ui._uiCalls.some(([call, message]) => call === "notify" && /Loading projects/i.test(message)),
  );
});

test("/projects: escape from folder list exits", async () => {
  const { pi, runCommand } = createMockPi();
  sessionsExtension(pi);
  const ctx = createMockCtx();
  ctx.ui.custom = async () => undefined; // Esc → no selection
  await runCommand("projects", "", ctx);
  assert.ok(true, "exits cleanly without crashing");
});
