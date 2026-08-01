/**
 * pi-statusline — e2e test suite (extension factory level)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate agent-dir I/O (mcp.json) in a temp dir, mirroring the unit suite
if (!process.env.PI_CODING_AGENT_DIR) {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-statusline-e2e-"));
  writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "mcp.json"), JSON.stringify({ mcpServers: { server1: { command: "npx" } } }));
}

import { loadSettings, saveSettings } from "../lib/_settings-ui.ts";
import { DEFAULT_SETTINGS } from "../lib/_types.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import statuslineExtension from "../index.ts";
import { createMockPi, createMockCtx, makeModel, makeTheme } from "../../../test/harness.mjs";

// ── E2E: extension registration ───────────────────────────────────

test("registers session_start/model_select/thinking_level_select + /statusline", () => {
  const { pi, handlers, commands } = createMockPi();
  statuslineExtension(pi);
  for (const e of ["session_start", "model_select", "thinking_level_select"]) {
    assert.ok(handlers.get(e)?.length, `must register ${e}`);
  }
  assert.ok(commands.has("statusline"));
});

test("session_start: registers widget (belowEditor) and footer", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await emit("session_start", {}, ctx);
  const widget = ctx.ui._uiCalls.find(([c]) => c === "setWidget");
  assert.ok(widget, "must set widget");
  assert.equal(widget[1], "pi-statusline");
  assert.equal(widget[3]?.placement, "belowEditor");
  assert.ok(ctx.ui._uiCalls.some(([c]) => c === "setFooter"), "must set footer");
});

test("widget render: shows model, git and effort", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await emit("session_start", {}, ctx);

  const widget = ctx.ui._uiCalls.find(([c]) => c === "setWidget");
  const component = widget[2]({ requestRender() {}, terminal: { rows: 30 } }, makeTheme());
  const lines = component.render(80);
  assert.ok(Array.isArray(lines) && lines.length === 1);
  assert.ok(lines[0].includes("claude-opus-4"), "model name in widget");
  assert.ok(lines[0].includes("High"), "effort level in widget");
});

test("widget render: truncates to width (no overflow crash)", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({
    model: makeModel("anthropic", "deepseek-v4-flash-very-long-model-name"),
    cwd: "/some/very/long/nested/project/path/that/pushes/the/statusline/past/118/columns",
  });
  await emit("session_start", {}, ctx);

  const widget = ctx.ui._uiCalls.find(([c]) => c === "setWidget");
  const component = widget[2]({ requestRender() {}, terminal: { rows: 30 } }, makeTheme());
  for (const width of [30, 60, 118]) {
    const lines = component.render(width);
    assert.ok(lines.length === 1, "single line");
    const w = visibleWidth(lines[0]);
    assert.ok(w <= width, `line width ${w} must not exceed ${width}`);
  }
});

test("widget render (preset-auto): degrades format as width shrinks", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await emit("session_start", {}, ctx);

  const widget = ctx.ui._uiCalls.find(([c]) => c === "setWidget");
  const component = widget[2]({ requestRender() {}, terminal: { rows: 30 } }, makeTheme());
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const wide = strip(component.render(400)[0]);
  assert.ok(wide.includes("Project:"), "very wide terminal shows the full-label format");
  assert.ok(wide.includes("Effort: High"), "full-label keeps the separate effort label");

  const verbose = strip(component.render(60)[0]);
  assert.ok(verbose.includes("P:"), "wide terminal shows the verbose labeled format");
  assert.ok(verbose.includes("E: High"), "verbose keeps the separate effort label");

  const medium = strip(component.render(40)[0]);
  assert.ok(medium.includes("claude-opus-4 - High"), "medium merges model-effort");
  assert.ok(!medium.includes("E: High"), "medium drops the separate effort label");

  const narrow = strip(component.render(20)[0]);
  assert.ok(!narrow.includes("P:"), "narrow drops the labels entirely");
  assert.ok(visibleWidth(narrow) <= 20, "narrow never overflows");
});

test("widget render (preset-auto): every width stays within budget", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({
    model: makeModel("anthropic", "deepseek-v4-flash-very-long-model-name"),
    cwd: "/some/very/long/nested/project/path/that/pushes/the/statusline/past/118/columns",
  });
  await emit("session_start", {}, ctx);

  const widget = ctx.ui._uiCalls.find(([c]) => c === "setWidget");
  const component = widget[2]({ requestRender() {}, terminal: { rows: 30 } }, makeTheme());
  for (const width of [20, 40, 60, 80, 118, 200]) {
    const lines = component.render(width);
    assert.ok(visibleWidth(lines[0]) <= width, `width ${width} must hold`);
  }
});

test("footer render: shows mcp server count and provider/model", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await emit("session_start", {}, ctx);

  const footer = ctx.ui._uiCalls.find(([c]) => c === "setFooter");
  assert.ok(footer, "footer must be registered");
  const tui = { requestRender() {}, terminal: { rows: 30 } };
  const component = footer[1](tui, makeTheme(), { onBranchChange: () => () => {} });
  const lines = component.render(80);
  assert.ok(lines[0].includes("1 servers enabled"), "mcp server count in footer");
  assert.ok(lines[0].includes("claude-opus-4"), "model name in footer");
  assert.ok(lines[0].includes("anthropic"), "provider in footer");
  component.dispose();
});

test("footer render: never exceeds width (no overflow crash)", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({
    model: makeModel("anthropic", "deepseek-v4-flash-very-long-model-name"),
  });
  await emit("session_start", {}, ctx);

  const footer = ctx.ui._uiCalls.find(([c]) => c === "setFooter");
  const tui = { requestRender() {}, terminal: { rows: 30 } };
  const component = footer[1](tui, makeTheme(), { onBranchChange: () => () => {} });
  for (const width of [30, 60, 118]) {
    const lines = component.render(width);
    assert.ok(lines.length === 1, "single line");
    const w = visibleWidth(lines[0]);
    assert.ok(w <= width, `line width ${w} must not exceed ${width}`);
  }
  component.dispose();
});

test("model_select: re-registers footer with the new model", async () => {
  const { pi, emit } = createMockPi();
  statuslineExtension(pi);
  await emit("session_start", {}, createMockCtx({ model: makeModel("anthropic", "a") }));
  const before = createMockCtx({ model: makeModel("openai", "gpt-4o") });
  await emit("model_select", { model: makeModel("openai", "gpt-4o"), source: "user" }, before);
  assert.ok(before.ui._uiCalls.some(([c]) => c === "setFooter"));
});

// ── E2E: /statusline command ──────────────────────────────────────

test("/statusline (default): notifies with rendered line + mcp info", async () => {
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await runCommand("statusline", "", ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === "notify");
  assert.ok(notify, "must notify");
  assert.match(notify[1], /claude-opus-4/);
  assert.match(notify[1], /MCP:/);
});

test("/statusline template: sets custom template and persists it", async () => {
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx();
  await runCommand("statusline", "template P: {project} | {model}", ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === "notify");
  assert.ok(notify, "must notify");
  assert.match(notify[1], /Custom template set/);
  assert.ok(loadSettings().format === "custom", "format must switch to custom");
  assert.equal(loadSettings().customTemplate, "P: {project} | {model}");
});

test("/statusline template: invalid token → error notify, nothing saved", async () => {
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx();
  await runCommand("statusline", "template {bogus}", ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === "notify");
  assert.ok(notify[1].includes("Unknown token"));
  assert.notEqual(loadSettings().customTemplate, "{bogus}");
});

test("/statusline reload: reloads from disk and notifies", async () => {
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  saveSettings({ ...DEFAULT_SETTINGS, format: "preset-full" });
  const ctx = createMockCtx();
  await runCommand("statusline", "reload", ctx);
  assert.ok(ctx.ui._uiCalls.some(([c, m]) => c === "notify" && /reloaded/i.test(m)));
});

test("/statusline settings: opens the settings panel via ctx.ui.custom", async () => {
  initTheme(); // pi's theme singleton required by getSettingsListTheme
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx();
  await runCommand("statusline", "settings", ctx);
  const custom = ctx.ui._uiCalls.find(([c]) => c === "custom");
  assert.ok(custom, "must open settings panel");
  // panel factory builds a Container-based component
  const component = custom[1]({ requestRender() {}, terminal: { rows: 30 } }, makeTheme(), {}, () => {});
  const lines = component.render(60);
  assert.ok(lines.some((l) => l.includes("Statusline Settings")));
});
