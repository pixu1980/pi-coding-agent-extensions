/**
 * pi-path-picker — e2e test suite (autocomplete provider)
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * Drives the extension factory with a mock ExtensionAPI: the provider wraps
 * the native provider and owns only path autocomplete inside quote pairs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pathPickerExtension from "./index.ts";
import { createMockPi, createMockCtx } from "../../test/harness.mjs";

function createProvider(cwd = "/tmp", nativeShouldTrigger = true) {
  const { pi, emit } = createMockPi();
  pathPickerExtension(pi);

  let registered = null;
  const captureCtx = createMockCtx({ cwd });
  captureCtx.ui.addAutocompleteProvider = (factory) => { registered = factory; };
  return (async () => {
    await emit("session_start", {}, captureCtx);
    assert.ok(registered, "must register an autocomplete provider on session_start");

    const calls = [];
    const current = {
      triggerCharacters: ["$"],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        calls.push(["getSuggestions", lines, cursorLine, cursorCol, options]);
        return { prefix: lines[cursorLine].slice(0, cursorCol), items: [{ value: "model", label: "model" }] };
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        calls.push(["applyCompletion", lines, cursorLine, cursorCol, item, prefix]);
        return { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        calls.push(["shouldTriggerFileCompletion", lines, cursorLine, cursorCol]);
        return nativeShouldTrigger;
      },
    };
    return { provider: registered(current), calls };
  })();
}

const SIG = { signal: new AbortController().signal };

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
