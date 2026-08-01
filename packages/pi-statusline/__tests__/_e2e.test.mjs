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
