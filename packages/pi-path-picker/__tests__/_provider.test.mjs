/**
 * pi-path-picker - e2e test suite (autocomplete provider)
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * Drives the extension factory with a mock ExtensionAPI: the provider wraps
 * the native provider and owns only path autocomplete inside quote pairs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProvider } from "./_helpers.mjs";

const SIG = { signal: new AbortController().signal };

function seedFiles(cwd, count) {
  for (let i = 1; i <= count; i++) {
    writeFileSync(join(cwd, `f${String(i).padStart(2, "0")}.txt`), "");
  }
}

// ── Outside delimiters: transparent native delegation ───────────────

test("built-in slash commands keep native suggestions", async () => {
  for (const command of ["/model", "/settings"]) {
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([command], 0, command.length, { ...SIG, force: false });
    assert.deepEqual(suggestions, { prefix: command, items: [{ value: "model", label: "model" }] }, `${command} must preserve native suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1, `${command} must delegate exactly once`);
  }
});

test("every other outside context stays owned by the wrapped provider", async () => {
  for (const [line, force] of [["@README", false], ["plain text", true], ["/reasoning ", false]]) {
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force });
    assert.equal(suggestions.prefix, line);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1, `${line} must delegate exactly once`);
  }
});

test("native file-trigger decision is preserved outside quote pairs", async () => {
  for (const nativeResult of [true, false]) {
    const { provider, calls } = await createProvider("/tmp", nativeResult);
    const result = provider.shouldTriggerFileCompletion(["/model"], 0, 6);
    assert.equal(result, nativeResult, "outside trigger decision must match native provider");
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 1);
  }
});

test("path picker adds no trigger characters of its own", async () => {
  const { provider } = await createProvider();
  assert.deepEqual(provider.triggerCharacters, ["$"]);
});

test("Tab after an incomplete quoted token never opens native files", async () => {
  for (const delimiter of ['"', "'", "`"]) {
    const line = `${delimiter}.`;
    const { provider, calls } = await createProvider();
    assert.equal(provider.shouldTriggerFileCompletion([line], 0, line.length), true);
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });
    assert.equal(suggestions, null, `${delimiter}. + Tab must not show suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
  }
});

test("deleting either quote from an open path menu closes it", async () => {
  for (const delimiter of ['"', "'", "`"]) {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = await createProvider(cwd);
    const openLine = `${delimiter}./${delimiter}`;
    const opened = await provider.getSuggestions([openLine], 0, 3, { ...SIG, force: true });
    assert.notEqual(opened, null, "precondition: quoted path menu must be open");

    for (const [line, cursorCol] of [
      [`${delimiter}./`, 3],
      [`./${delimiter}`, 2],
    ]) {
      assert.equal(provider.shouldTriggerFileCompletion([line], 0, cursorCol), true);
      const suggestions = await provider.getSuggestions([line], 0, cursorCol, { ...SIG, force: true });
      assert.equal(suggestions, null, "broken quote pair must close autocomplete");
      assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
    }
  }
});

test("escaped delimiters are plain text and preserve native behavior", async () => {
  for (const delimiter of ['"', "'", "`"]) {
    const line = `\\${delimiter}`;
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: false });
    assert.deepEqual(suggestions, { prefix: line, items: [{ value: "model", label: "model" }] }, `escaped ${delimiter} must preserve native suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1);
  }
});

test("applyCompletion outside delegates to current", async () => {
  const { provider, calls } = await createProvider();
  const result = provider.applyCompletion(["/mod"], 0, 4, { value: "/model", label: "model" }, "/mod");
  assert.deepEqual(result, { lines: ["/model "], cursorLine: 0, cursorCol: 7 });
  assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 1);
});

// ── Inside delimiters: path autocomplete, no delegation ──

test("TAB inside every supported quote pair with a slash → path autocomplete", async () => {
  for (const delimiter of ['"', "'", "`"]) {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = await createProvider(cwd);
    const line = `${delimiter}./${delimiter}`;
    const suggestions = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });
    assert.notEqual(suggestions, null, `TAB inside ${delimiter} pair must trigger path picker`);
    assert.equal(suggestions.prefix, "./");
    assert.equal(suggestions.items.some((item) => item.value === "./alpha.txt"), true, "should find alpha.txt");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
  }
});

test("natural typing never opens path autocomplete", async () => {
  for (const path of ["/", "~/", "./", "../"]) {
    const { provider, calls } = await createProvider();
    const line = `"${path}"`;
    const suggestions = await provider.getSuggestions([line], 0, path.length + 1, { ...SIG, force: false });
    assert.equal(suggestions, null, `${path} must require Tab`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
  }
});

test("Tab without a slash does not trigger path autocomplete", async () => {
  const { provider, calls } = await createProvider();
  assert.equal(provider.shouldTriggerFileCompletion(['"~"'], 0, 2), true);
  const suggestions = await provider.getSuggestions(['"~"'], 0, 2, { ...SIG, force: true });
  assert.equal(suggestions, null, "Tab must require a slash in the quoted token");
  assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
});

test("TAB inside quotes with / → absolute path", async () => {
  const { provider, calls } = await createProvider();
  const suggestions = await provider.getSuggestions(['"/"'], 0, 2, { ...SIG, force: true });
  assert.notEqual(suggestions, null, 'TAB after "/" inside quotes must trigger path picker');
  assert.equal(suggestions.prefix, "/");
  assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0);
});

test("shouldTriggerFileCompletion inside with path containing slash → true, no delegation", async () => {
  const { provider, calls } = await createProvider();
  assert.equal(provider.shouldTriggerFileCompletion(['"./s"'], 0, 4), true);
  assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0);
});

test("shouldTriggerFileCompletion inside without slash refreshes to close stale menus", async () => {
  const { provider, calls } = await createProvider();
  assert.equal(provider.shouldTriggerFileCompletion(['"plain"'], 0, 6), true);
  assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0);
});

test("applyCompletion inside → path replacement works", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
  writeFileSync(join(cwd, "alpha.txt"), "");
  const { provider, calls } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./"'], 0, 3, { ...SIG, force: true });
  const applied = provider.applyCompletion(['"./"'], 0, 3, suggestions.items.find((item) => item.value === "./alpha.txt"), suggestions.prefix);
  assert.deepEqual(applied, { lines: ['"./alpha.txt"'], cursorLine: 0, cursorCol: 12 });
  assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 0, "path apply must not delegate");
});

// ── Detailed mode (Tab twice): list every file and directory ─────────────

test("first Tab caps suggestions at the autocomplete limit", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
  seedFiles(cwd, 40);
  const { provider } = await createProvider(cwd);

  const line = '"./"';
  const first = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });

  assert.equal(first.items.length, 30, "first Tab must cap at the autocomplete limit");
  assert.equal(first.items.some((item) => item.value === "./f40.txt"), false, "items beyond the cap must be hidden");
});

test("second Tab on the same token lists every file and directory (detailed mode)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
  seedFiles(cwd, 40);
  writeFileSync(join(cwd, ".env"), "");
  mkdirSync(join(cwd, "subdir"));
  const { provider } = await createProvider(cwd);

  const line = '"./"';
  const first = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });
  assert.equal(first.items.length, 30, "precondition: first Tab is capped");

  const second = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });
  assert.equal(second.items.length, 42, "second Tab must list all 40 files + .env + subdir");
  assert.equal(second.items.some((item) => item.value === "./f40.txt"), true);
  assert.equal(second.items.some((item) => item.value === "./.env"), true, "detailed mode must include hidden files");
  assert.equal(second.items.some((item) => item.value === "./subdir/"), true);
});

test("detailed mode ignores the partial-name prefix and lists the whole directory", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
  seedFiles(cwd, 40);
  writeFileSync(join(cwd, "other.txt"), "");
  const { provider } = await createProvider(cwd);

  const line = '"./f"';
  const first = await provider.getSuggestions([line], 0, 4, { ...SIG, force: true });
  assert.equal(first.items.every((item) => item.value.startsWith("./f")), true, "first Tab filters by the typed prefix");

  const second = await provider.getSuggestions([line], 0, 4, { ...SIG, force: true });
  assert.equal(second.items.length, 41, "detailed mode must list files outside the prefix too");
  assert.equal(second.items.some((item) => item.value === "./other.txt"), true);
});

test("typing after detailed mode resets back to the capped autocomplete", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
  seedFiles(cwd, 40);
  writeFileSync(join(cwd, "other.txt"), "");
  const { provider } = await createProvider(cwd);

  const open = await provider.getSuggestions(['"./"'], 0, 3, { ...SIG, force: true });
  assert.equal(open.items.length, 30);
  const detailed = await provider.getSuggestions(['"./"'], 0, 3, { ...SIG, force: true });
  assert.equal(detailed.items.length, 41, "precondition: detailed mode lists everything");

  // Typing narrows the token: the new snapshot starts a fresh autocomplete.
  const typed = await provider.getSuggestions(['"./f"'], 0, 4, { ...SIG, force: true });
  assert.equal(typed.items.length, 30, "a changed token must reset to the capped list");
  assert.equal(typed.items.every((item) => item.value.startsWith("./f")), true);
});

test("detailed mode still refuses sensitive directories", async () => {
  const { provider } = await createProvider();

  const line = '"~/.ssh/"';
  const first = await provider.getSuggestions([line], 0, 8, { ...SIG, force: true });
  assert.equal(first, null);
  const second = await provider.getSuggestions([line], 0, 8, { ...SIG, force: true });
  assert.equal(second, null, "detailed mode must keep the sensitive-directory guard");
});
