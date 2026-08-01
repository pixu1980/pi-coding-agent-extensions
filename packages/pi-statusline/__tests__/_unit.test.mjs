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

import { fmtTokens, gradient, gradientColor } from "../lib/_colors.ts";
import {
  validateTemplate,
  resolveTemplate,
  compileTemplate,
  renderStatusLine,
} from "../lib/_template.ts";
import { getGitStatus, invalidateGitCache } from "../lib/_git.ts";
import { loadSettings, saveSettings } from "../lib/_settings-ui.ts";
import { PRESET_TEMPLATES, DEFAULT_SETTINGS } from "../lib/_types.ts";

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

