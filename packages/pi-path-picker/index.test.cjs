const assert = require("node:assert/strict");
const { readFileSync, writeFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
// Load jiti from pi's bundled location. Uses createRequire to resolve
// jiti regardless of pi's installed version.
const { createRequire } = require("module");
const piRequire = createRequire(
  "/opt/homebrew/Cellar/pi-coding-agent/" +
  require("fs").readdirSync("/opt/homebrew/Cellar/pi-coding-agent/").filter(f => f.match(/^\d+\.\d+\.\d+$/)).sort().at(-1) +
  "/libexec/lib/node_modules/@earendil-works/pi-coding-agent/package.json"
);
const { createJiti } = piRequire("jiti");

function loadExtensionForTest() {
  const sourcePath = join(__dirname, "index.ts");
  let source = readFileSync(sourcePath, "utf8");

  source = source
    .replace(/^import \{ spawnSync \} from "node:child_process";$/m, 'const { spawnSync } = require("node:child_process");')
    .replace(/^import \{ existsSync, readdirSync, statSync \} from "node:fs";$/m, 'const { existsSync, readdirSync, statSync } = require("node:fs");')
    .replace(/^import \{ resolve, join, sep, basename, dirname, isAbsolute \} from "node:path";$/m, 'const { resolve, join, sep, basename, dirname, isAbsolute } = require("node:path");')
    .replace(/^import \{ homedir \} from "node:os";$/m, 'const { homedir } = require("node:os");')
    .replace(/^import type .* from "@earendil-works\/pi-coding-agent";$/m, "")
    .replace("export default function pathPickerExtension", "function pathPickerExtension");

  source += "\nmodule.exports = { default: pathPickerExtension };\n";

  const dir = mkdtempSync(join(tmpdir(), "path-picker-test-"));
  const compiledPath = join(dir, "index.test-subject.ts");
  writeFileSync(compiledPath, source, "utf8");

  const jiti = createJiti(compiledPath, { interopDefault: true, moduleCache: false });
  return jiti(compiledPath).default;
}

function createProvider(cwd = "/tmp", nativeShouldTrigger = true) {
  const extension = loadExtensionForTest();
  const handlers = new Map();
  const pi = {
    registerCommand() {},
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
  };

  extension(pi);

  let providerFactory;
  const ctx = {
    cwd,
    ui: {
      addAutocompleteProvider(factory) { providerFactory = factory; },
      notify() {},
    },
  };
  handlers.get("session_start")({}, ctx);

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

  return { provider: providerFactory(current), calls };
}

(async () => {
  // ── Outside delimiters: transparent native delegation ───────
  // pi-path-picker owns only text inside a closed quote pair. Every other
  // autocomplete operation must preserve the native provider behavior.

  // Test 1: built-in slash commands keep native suggestions
  for (const command of ["/model", "/settings"]) {
    const { provider, calls } = createProvider();
    const options = { signal: new AbortController().signal, force: false };
    const suggestions = await provider.getSuggestions([command], 0, command.length, options);
    assert.deepEqual(suggestions, {
      prefix: command,
      items: [{ value: "model", label: "model" }],
    }, `${command} must preserve native suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1, `${command} must delegate exactly once`);
  }

  // Test 2: every other outside context, including /reasoning args,
  // remains entirely owned by the wrapped provider
  for (const [line, force] of [["@README", false], ["plain text", true], ["/reasoning ", false]]) {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force,
    });
    assert.equal(suggestions.prefix, line);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1, `${line} must delegate exactly once`);
  }

  // Test 3: native file-trigger decision is preserved outside quote pairs
  for (const nativeResult of [true, false]) {
    const { provider, calls } = createProvider("/tmp", nativeResult);
    const result = provider.shouldTriggerFileCompletion(["/model"], 0, 6);
    assert.equal(result, nativeResult, "outside trigger decision must match native provider");
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 1, "outside trigger decision must delegate exactly once");
  }

  // Test 4: path picker adds no trigger characters of its own
  {
    const { provider } = createProvider();
    assert.deepEqual(provider.triggerCharacters, ["$"], "native trigger characters must pass through unchanged");
  }

  // Test 5: Tab after an incomplete quoted token never opens native files
  for (const delimiter of ['"', "'", "`"]) {
    const line = `${delimiter}.`;
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion([line], 0, line.length), true, "invalid quote context must be re-queried so stale menus can close");
    const suggestions = await provider.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: true,
    });
    assert.equal(suggestions, null, `${delimiter}. + Tab must not show suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, `${delimiter}. + Tab must not delegate`);
  }

  // Test 6: deleting either quote from an open path menu closes it
  for (const delimiter of ['"', "'", "`"]) {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = createProvider(cwd);
    const openLine = `${delimiter}./${delimiter}`;
    const opened = await provider.getSuggestions([openLine], 0, 3, {
      signal: new AbortController().signal,
      force: true,
    });
    assert.notEqual(opened, null, "precondition: quoted path menu must be open");

    for (const [line, cursorCol] of [
      [`${delimiter}./`, 3],
      [`./${delimiter}`, 2],
    ]) {
      assert.equal(provider.shouldTriggerFileCompletion([line], 0, cursorCol), true, "broken quote pair must trigger menu refresh");
      const suggestions = await provider.getSuggestions([line], 0, cursorCol, {
        signal: new AbortController().signal,
        force: true,
      });
      assert.equal(suggestions, null, "broken quote pair must close autocomplete");
      assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "broken quote pair must not delegate");
    }
  }

  // Test 7: escaped delimiters are plain text and preserve native behavior
  for (const delimiter of ['"', "'", "`"]) {
    const line = `\\${delimiter}`;
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: false,
    });
    assert.deepEqual(suggestions, {
      prefix: line,
      items: [{ value: "model", label: "model" }],
    }, `escaped ${delimiter} must preserve native suggestions`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 1, `escaped ${delimiter} must delegate exactly once`);
  }

  // Test 8: applyCompletion outside → delegate to current
  {
    const { provider, calls } = createProvider();
    const result = provider.applyCompletion(["/mod"], 0, 4, { value: "/model", label: "model" }, "/mod");
    assert.deepEqual(result, { lines: ["/model "], cursorLine: 0, cursorCol: 7 });
    assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 1, "applyCompletion outside must delegate");
  }

  // ── Inside delimiters: path autocomplete, no delegation ──

  // Test 9: TAB inside every supported quote pair with a slash → path autocomplete
  for (const delimiter of ['"', "'", "`"]) {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = createProvider(cwd);
    const line = `${delimiter}./${delimiter}`;
    const suggestions = await provider.getSuggestions([line], 0, 3, {
      signal: new AbortController().signal,
      force: true,
    });
    assert.notEqual(suggestions, null, `TAB inside ${delimiter} pair must trigger path picker`);
    assert.equal(suggestions.prefix, "./");
    assert.equal(suggestions.items.some((item) => item.value === "./alpha.txt"), true, "should find alpha.txt");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, `no delegation inside ${delimiter} pair`);
  }

  // Test 10: natural typing never opens path autocomplete
  for (const path of ["/", "~/", "./", "../"]) {
    const { provider, calls } = createProvider();
    const line = `"${path}"`;
    const suggestions = await provider.getSuggestions([line], 0, path.length + 1, {
      signal: new AbortController().signal,
      force: false,
    });
    assert.equal(suggestions, null, `${path} must require Tab`);
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, `${path} natural typing must not delegate`);
  }

  // Test 11: Tab without a slash does not trigger path autocomplete
  {
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion(['"~"'], 0, 2), true);
    const suggestions = await provider.getSuggestions(['"~"'], 0, 2, {
      signal: new AbortController().signal,
      force: true,
    });
    assert.equal(suggestions, null, "Tab must require a slash in the quoted token");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "quoted token without slash must not delegate");
  }

  // Test 12: TAB inside quotes with / → absolute path
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(['"/"'], 0, 2, { signal: new AbortController().signal, force: true });
    assert.notEqual(suggestions, null, 'TAB after "/" inside quotes must trigger path picker');
    assert.equal(suggestions.prefix, "/");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "no delegation for absolute path inside quotes");
  }

  // Test 13: shouldTriggerFileCompletion inside with path containing slash → true
  {
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion(['"./s"'], 0, 4), true);
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0, "no delegation for path inside quotes");
  }

  // Test 14: shouldTriggerFileCompletion inside without slash refreshes to close stale menus
  {
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion(['"plain"'], 0, 6), true);
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0, "no delegation inside delimiters");
  }

  // Test 15: applyCompletion inside → path replacement works
  {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = createProvider(cwd);
    const suggestions = await provider.getSuggestions(['"./"'], 0, 3, { signal: new AbortController().signal, force: true });
    const applied = provider.applyCompletion(['"./"'], 0, 3, suggestions.items.find((item) => item.value === "./alpha.txt"), suggestions.prefix);
    assert.deepEqual(applied, { lines: ['"./alpha.txt"'], cursorLine: 0, cursorCol: 12 });
    assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 0, "path apply must not delegate");
  }

  console.log("path-picker autocomplete tests passed");
})();
