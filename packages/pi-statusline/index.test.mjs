/**
 * pi-statusline — unit + e2e test suite
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * - Unit: colors (fmtTokens/gradient), template (validate/resolve/compile/render),
 *   git status detection (temp repo), settings persistence
 * - E2E: extension factory with mock ExtensionAPI — widget + footer registration,
 *   /statusline command (default / settings / template / reload)
 *
 * All filesystem side effects are isolated under PI_CODING_AGENT_DIR (temp dir).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── Isolate all agent-dir I/O (settings.json, mcp.json) in a temp dir ──
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-statusline-test-"));
// One configured MCP server so getMcpInfo is deterministic across tests
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "mcp.json"), JSON.stringify({ mcpServers: { server1: { command: "npx" } } }));

import { fmtTokens, gradient, gradientColor } from "./colors.ts";
import {
  validateTemplate,
  resolveTemplate,
  compileTemplate,
  renderStatusLine,
} from "./template.ts";
import { getGitStatus, invalidateGitCache } from "./git.ts";
import { loadSettings, saveSettings } from "./settings-ui.ts";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { PRESET_TEMPLATES, DEFAULT_SETTINGS } from "./types.ts";
import statuslineExtension from "./index.ts";
import { createMockPi, createMockCtx, makeModel, makeTheme } from "../../test/harness.mjs";

// ── Sample data ────────────────────────────────────────────────────

const DATA = {
  project: "/home/dev/my-app",
  git: { branch: "feature/x", ahead: 3, behind: 1, dirty: 2, hasUpstream: true },
  hasGit: true,
  model: "claude-opus-4",
  modelContext: 1_000_000,
  effort: "High",
  contextUsed: 901_000,
  contextTotal: 1_000_000,
  contextPct: 90,
  initialPrompt: "Refactor the auth module",
};

// ── Unit: colors ──────────────────────────────────────────────────

test("fmtTokens: <1k plain, k suffix, M suffix", () => {
  assert.equal(fmtTokens(0), "0");
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(1000), "1k");
  assert.equal(fmtTokens(1500), "2k");
  assert.equal(fmtTokens(1_000_000), "1.0M");
});

test("gradientColor: clamps to 0..1 and emits ANSI true color", () => {
  const green = gradientColor(0);
  const red = gradientColor(1);
  assert.match(green, /^\x1b\[38;2;\d+;\d+;\d+m$/);
  assert.match(red, /^\x1b\[38;2;\d+;\d+;\d+m$/);
  // clamping: out-of-range values behave like the boundary
  assert.equal(gradientColor(-5), gradientColor(0));
  assert.equal(gradientColor(99), gradientColor(1));
});

test("gradient: wraps text with color and reset", () => {
  const out = gradient("50%", 0.5);
  assert.ok(out.startsWith("\x1b["));
  assert.ok(out.endsWith("\x1b[0m"));
  assert.ok(out.includes("50%"));
});

// ── Unit: template validation & resolution ────────────────────────

test("validateTemplate: accepts known tokens", () => {
  assert.equal(validateTemplate("P: {project} › M: {model}"), null);
});

test("validateTemplate: rejects unknown tokens with message", () => {
  const err = validateTemplate("{bogus}");
  assert.ok(err && err.includes("bogus"));
  assert.ok(err && err.includes("Valid:"));
});

test("resolveTemplate: preset formats map to preset templates", () => {
  assert.equal(resolveTemplate({ ...DEFAULT_SETTINGS, format: "preset-full" }), PRESET_TEMPLATES["preset-full"]);
  assert.equal(resolveTemplate({ ...DEFAULT_SETTINGS, format: "preset-minimal" }), PRESET_TEMPLATES["preset-minimal"]);
});

test("resolveTemplate: custom format uses custom template, falls back to preset-compact", () => {
  assert.equal(
    resolveTemplate({ ...DEFAULT_SETTINGS, format: "custom", customTemplate: "{model}" }),
    "{model}",
  );
  assert.equal(
    resolveTemplate({ ...DEFAULT_SETTINGS, format: "custom", customTemplate: "" }),
    PRESET_TEMPLATES["preset-compact"],
  );
});

// ── Unit: compile + render ────────────────────────────────────────

test("compileTemplate: valid template returns a function, invalid returns error string", () => {
  const fn = compileTemplate("{project} {model}");
  assert.equal(typeof fn, "function");
  const err = compileTemplate("{nope}");
  assert.equal(typeof err, "string");
});

test("renderStatusLine: renders required tokens", () => {
  const compiled = compileTemplate("P:{project}|M:{model}");
  const line = renderStatusLine(DATA, compiled);
  assert.ok(line.includes("my-app"));
  assert.ok(line.includes("claude-opus-4"));
});

test("renderStatusLine: git status tokens render ahead/behind/dirty", () => {
  const compiled = compileTemplate("{git_status}");
  const line = renderStatusLine(DATA, compiled);
  assert.ok(line.includes("⇡3"));
  assert.ok(line.includes("⇣1"));
  assert.ok(line.includes("!2"));
});

test("renderStatusLine: no git → optional tokens disappear and decorators are cleaned", () => {
  const compiled = compileTemplate("P: {project} › B: {branch} S: {git_status}");
  const line = renderStatusLine({ ...DATA, git: null, hasGit: false }, compiled);
  assert.ok(line.includes("my-app"));
  assert.ok(!line.includes("feature/x"));
  assert.ok(!line.includes("()"), "empty parens must be removed");
});

test("renderStatusLine: context token formats used/total (pct)", () => {
  const compiled = compileTemplate("{context}");
  const line = renderStatusLine(DATA, compiled);
  assert.ok(line.includes("901k"));
  assert.ok(line.includes("1.0M"));
  assert.ok(line.includes("90%"));
});

test("renderStatusLine: individual context tokens", () => {
  const compiled = compileTemplate("{context_used}|{context_total}|{context_pct}");
  const line = renderStatusLine(DATA, compiled);
  // context_pct is gradient-colored, so compare token values rather than a contiguous string
  assert.ok(line.includes("901k"));
  assert.ok(line.includes("1.0M"));
  assert.ok(line.includes("90%"));
});

test("renderStatusLine: unknown-but-valid optional token empty when no git", () => {
  const compiled = compileTemplate("[{git_dirty}] {model}");
  const line = renderStatusLine({ ...DATA, git: null, hasGit: false }, compiled);
  assert.ok(!line.includes("[]"));
});

test("renderStatusLine: initial prompt token renders", () => {
  const compiled = compileTemplate("{initial_prompt}");
  assert.ok(renderStatusLine(DATA, compiled).includes("Refactor the auth module"));
});

// ── Unit: git detection (uses process.cwd — temp repo) ────────────

function withTempGitRepo(fn) {
  const originalCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-git-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name Tester", { cwd: dir });
  writeFileSync(join(dir, "file.txt"), "hello\n");
  execSync("git add . && git commit -qm init", { cwd: dir });
  process.chdir(dir);
  try {
    fn(dir);
  } finally {
    process.chdir(originalCwd);
  }
}

test("getGitStatus: non-git directory reports no git", () => {
  invalidateGitCache();
  const plain = mkdtempSync(join(tmpdir(), "pi-statusline-nogit-"));
  const originalCwd = process.cwd();
  process.chdir(plain);
  try {
    const result = getGitStatus(plain, true);
    assert.equal(result.hasGit, false);
    assert.equal(result.status, null);
  } finally {
    process.chdir(originalCwd);
  }
});

test("getGitStatus: clean repo reports branch + zero dirty", () => {
  invalidateGitCache();
  withTempGitRepo(() => {
    const { status, hasGit } = getGitStatus(process.cwd(), true);
    assert.equal(hasGit, true);
    assert.equal(status.branch, "main");
    assert.equal(status.dirty, 0);
    assert.equal(status.hasUpstream, false);
    assert.equal(status.ahead, 0);
  });
});

test("getGitStatus: dirty repo counts modified files", () => {
  invalidateGitCache();
  withTempGitRepo((dir) => {
    writeFileSync(join(dir, "file.txt"), "changed\n");
    const { status } = getGitStatus(process.cwd(), true);
    assert.equal(status.dirty, 1);
  });
});

// ── Unit: settings persistence (isolated agent dir) ───────────────

test("loadSettings: missing file returns defaults", () => {
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test("saveSettings + loadSettings round-trip", () => {
  const custom = { ...DEFAULT_SETTINGS, format: "custom", customTemplate: "{model} {effort}" };
  saveSettings(custom);
  assert.deepEqual(loadSettings(), custom);
  const p = join(process.env.PI_CODING_AGENT_DIR, "pi-statusline.json");
  assert.ok(existsSync(p), "settings file must be written to the agent dir");
  assert.ok(readFileSync(p, "utf8").includes("customTemplate"));
});

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
