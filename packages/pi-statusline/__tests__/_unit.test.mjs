/**
 * pi-statusline - unit + e2e test suite
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * - Unit: colors (fmtTokens/gradient), template (validate/resolve/compile/render),
 *   git status detection (temp repo), settings persistence
 * - E2E: extension factory with mock ExtensionAPI - widget + footer registration,
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
  renderResponsive,
} from "../lib/_template.ts";
import { getGitStatus, invalidateGitCache } from "../lib/_git.ts";
import { loadSettings, saveSettings } from "../lib/_settings-ui.ts";
import { PRESET_TEMPLATES, DEFAULT_SETTINGS } from "../lib/_types.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

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

// ── Unit: responsive cascade (preset-auto) ────────────────────────

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Data matching the user's real-world example (clean repo, empty context)
const USER_DATA = {
  project: "~/Projects/pixu1980/pi-coding-agent-extensions",
  git: { branch: "main", ahead: 0, behind: 0, dirty: 0, hasUpstream: true },
  hasGit: true,
  model: "DeepSeek V4 Flash",
  modelContext: 1_000_000,
  effort: "High",
  contextUsed: 0,
  contextTotal: 1_000_000,
  contextPct: 0,
  initialPrompt: "",
};

test("renderResponsive: very wide width renders the full-label level", () => {
  const line = renderResponsive(USER_DATA, 10_000);
  assert.equal(
    strip(line),
    "Project: ~/Projects/pixu1980/pi-coding-agent-extensions › Branch: main › Model: DeepSeek V4 Flash Effort: High › Context: 0/1.0M (0%)",
    "full-label level spells out section names, keeps the full path, separate effort label and pct",
  );
});

test("renderResponsive: wide width degrades to the verbose labeled level", () => {
  const full = renderResponsive(USER_DATA, 10_000);
  const line = renderResponsive(USER_DATA, visibleWidth(full) - 1);
  assert.equal(
    strip(line),
    "P: ~/Projects/pixu1980/pi-coding-agent-extensions › B: main › M: DeepSeek V4 Flash E: High › C: 0/1.0M (0%)",
    "verbose level keeps the full path, separate effort label and pct",
  );
});

test("renderResponsive: medium width degrades to the compact level", () => {
  const full = renderResponsive(USER_DATA, 10_000);
  const verbose = renderResponsive(USER_DATA, visibleWidth(full) - 1);
  const line = renderResponsive(USER_DATA, visibleWidth(verbose) - 1);
  assert.equal(
    strip(line),
    "P: pi-coding-agent-extensions › B: main › M: DeepSeek V4 Flash - High › C: 0/1.0M",
    "compact level uses the bare project name and merges model-effort",
  );
});

test("renderResponsive: narrow width degrades to the minimal level", () => {
  const full = renderResponsive(USER_DATA, 10_000);
  const verbose = renderResponsive(USER_DATA, visibleWidth(full) - 1);
  const compact = renderResponsive(USER_DATA, visibleWidth(verbose) - 1);
  const line = renderResponsive(USER_DATA, visibleWidth(compact) - 1);
  assert.equal(
    strip(line),
    "pi-coding-agent-extensions | main | DeepSeek V4 Flash - High | 0/1.0M",
    "minimal level drops labels and uses pipe separators",
  );
});

test("renderResponsive: levels are progressively narrower (monotonic)", () => {
  const l0 = renderResponsive(DATA, 10_000);
  const l1 = renderResponsive(DATA, visibleWidth(l0) - 1);
  const l2 = renderResponsive(DATA, visibleWidth(l1) - 1);
  const l3 = renderResponsive(DATA, visibleWidth(l2) - 1);
  assert.ok(visibleWidth(l1) < visibleWidth(l0), "verbose narrower than full-label");
  assert.ok(visibleWidth(l2) < visibleWidth(l1), "compact narrower than verbose");
  assert.ok(visibleWidth(l3) < visibleWidth(l2), "minimal narrower than compact");
  assert.ok(visibleWidth(l3) <= visibleWidth(l2) - 1);
});

test("renderResponsive: preserves colors at every level", () => {
  const full = renderResponsive(DATA, 10_000);
  const verbose = renderResponsive(DATA, visibleWidth(full) - 1);
  const compact = renderResponsive(DATA, visibleWidth(verbose) - 1);
  const minimal = renderResponsive(DATA, visibleWidth(compact) - 1);
  for (const line of [full, verbose, compact, minimal]) {
    assert.ok(line.includes("\x1b[38;2;255;180;100m"), "model stays orange-gold");
    assert.ok(line.includes("\x1b[38;2;180;220;100m"), "effort stays lime-green");
    assert.ok(line.includes("\x1b[38;2;140;140;140m"), "labels/separators stay dim grey");
    // gradient code sits directly before the used-token count at every level
    assert.match(line, /\x1b\[38;2;\d+;\d+;\d+m901k/, "context keeps the gradient");
  }
});

test("renderResponsive: compact/minimal keep the '/' between used and total gradient-colored", () => {
  const full = renderResponsive(DATA, 10_000);
  const verbose = renderResponsive(DATA, visibleWidth(full) - 1);
  const compact = renderResponsive(DATA, visibleWidth(verbose) - 1);
  const minimal = renderResponsive(DATA, visibleWidth(compact) - 1);
  for (const line of [compact, minimal]) {
    // 901k → reset → gradient-coded '/' → reset → gradient-coded 1.0M
    assert.match(
      line,
      /901k\x1b\[0m\x1b\[38;2;\d+;\d+;\d+m\/\x1b\[0m\x1b\[38;2;\d+;\d+;\d+m1\.0M/,
      "the '/' keeps the context percentage gradient instead of dim grey",
    );
    assert.ok(
      !line.includes("\x1b[38;2;140;140;140m/\x1b[0m") &&
      !line.includes("901k\x1b[0m\x1b[38;2;140;140;140m/"),
      "no dim-grey slash adjacent to the context numbers",
    );
  }
});

test("renderResponsive: model name passes through verbatim at every level", () => {
  const withBadge = { ...DATA, model: "DeepSeek V4 Flash (New)" };
  const l0 = renderResponsive(withBadge, 10_000);
  const l1 = renderResponsive(withBadge, visibleWidth(l0) - 1);
  const l2 = renderResponsive(withBadge, visibleWidth(l1) - 1);
  const l3 = renderResponsive(withBadge, visibleWidth(l2) - 1);
  for (const line of [l0, l1, l2, l3]) {
    assert.ok(strip(line).includes("DeepSeek V4 Flash (New)"), "model badge is preserved, not dropped");
  }
});

test("renderResponsive: git status shows at every level", () => {
  const full = renderResponsive(DATA, 10_000);
  assert.ok(full.includes("⇡3"), "full-label keeps ahead");
  assert.ok(full.includes("⇣1"), "full-label keeps behind");
  assert.ok(full.includes("!2"), "full-label keeps dirty");
  const verbose = renderResponsive(DATA, visibleWidth(full) - 1);
  assert.ok(verbose.includes("⇡3"));
  const compact = renderResponsive(DATA, visibleWidth(verbose) - 1);
  assert.ok(compact.includes("⇡3"));
  const minimal = renderResponsive(DATA, visibleWidth(compact) - 1);
  assert.ok(minimal.includes("⇡3"));
});

test("renderResponsive: too-narrow width falls back to minimal, never crashes", () => {
  const line = renderResponsive(DATA, 10);
  assert.ok(strip(line).includes("my-app"), "fallback still shows project");
  assert.ok(strip(line).includes("claude-opus-4 - High"));
  // Caller truncates; here we just verify it doesn't throw and is colored.
  assert.ok(line.includes("\x1b["), "fallback remains ANSI-colored");
});

test("renderResponsive: empty git → branch/git_status sections collapse", () => {
  const noGit = { ...DATA, git: null, hasGit: false };
  const line = renderResponsive(noGit, 10_000);
  assert.ok(!strip(line).includes("feature/x"));
  assert.ok(!strip(line).includes("B:"), "no empty branch section");
  assert.ok(!strip(line).includes("Branch:"), "no empty branch section in full-label level");
  assert.ok(!strip(line).includes("Status:"), "no empty status section in full-label level");
});

test("renderResponsive: custom short project name already stays put", () => {
  const short = { ...DATA, project: "my-app" };
  const l1 = renderResponsive(short, 10_000);
  const l2 = renderResponsive(short, visibleWidth(l1) - 1);
  assert.ok(strip(l2).includes("P: my-app"));
});

// ── Unit: git detection (uses process.cwd - temp repo) ────────────

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

