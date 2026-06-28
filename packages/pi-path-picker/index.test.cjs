const assert = require("node:assert/strict");
const { readFileSync, writeFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createJiti } = require("/opt/homebrew/Cellar/pi-coding-agent/0.80.2/libexec/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs");

function loadExtensionForTest() {
  const sourcePath = join(__dirname, "index.ts");
  let source = readFileSync(sourcePath, "utf8");

  source = source
    .replace(/^import \{ spawnSync, execSync \} from "node:child_process";$/m, 'const { spawnSync, execSync } = require("node:child_process");')
    .replace(/^import \{ existsSync, readdirSync, statSync \} from "node:fs";$/m, 'const { existsSync, readdirSync, statSync } = require("node:fs");')
    .replace(/^import \{ resolve, join, sep, basename, dirname, isAbsolute \} from "node:path";$/m, 'const { resolve, join, sep, basename, dirname, isAbsolute } = require("node:path");')
    .replace(/^import \{ homedir \} from "node:os";$/m, 'const { homedir } = require("node:os");')
    .replace(/^import type .* from "@earendil-works\/pi-coding-agent";$/m, "")
    .replace(/^import \{ Type \} from "typebox";$/m, "const Type = { Object: (schema) => schema, Optional: (schema) => schema, String: (schema) => schema, Number: (schema) => schema };")
    .replace(/^import \{ StringEnum \} from "@earendil-works\/pi-ai";$/m, "const StringEnum = (values, _options) => values;")
    .replace("export default function pathPickerExtension", "function pathPickerExtension");

  source += "\nmodule.exports = { default: pathPickerExtension };\n";

  const dir = mkdtempSync(join(tmpdir(), "path-picker-test-"));
  const compiledPath = join(dir, "index.test-subject.ts");
  writeFileSync(compiledPath, source, "utf8");

  const jiti = createJiti(compiledPath, { interopDefault: true, moduleCache: false });
  return jiti(compiledPath).default;
}

function createProvider(cwd = "/tmp") {
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
      return true;
    },
  };

  return { provider: providerFactory(current), calls };
}

(async () => {
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal, force: false });
    assert.equal(suggestions.prefix, "/");
    const applied = provider.applyCompletion(["/"], 0, 1, suggestions.items[0], suggestions.prefix);
    assert.deepEqual(applied, { lines: ["/model "], cursorLine: 0, cursorCol: 7 });
    assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 1, "slash command completion must delegate to native provider");
  }

  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(['"/"'], 0, 2, { signal: new AbortController().signal, force: false });
    assert.equal(suggestions, null, "typing / inside quotes must not trigger path picker unless Tab forced it");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "natural path autocomplete inside quotes must not delegate to native file completion");
  }

  {
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion(["plain text"], 0, 10), true);
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 1, "outside delimiters, Tab eligibility must delegate to native provider");
  }

  {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = createProvider(cwd);
    const suggestions = await provider.getSuggestions(['"./"'], 0, 3, { signal: new AbortController().signal, force: true });
    assert.equal(suggestions.prefix, "./");
    assert.equal(suggestions.items.some((item) => item.value === "./alpha.txt"), true, "Tab inside delimiters should still provide path picker suggestions");
    const applied = provider.applyCompletion(['"./"'], 0, 3, suggestions.items.find((item) => item.value === "./alpha.txt"), suggestions.prefix);
    assert.deepEqual(applied, { lines: ['"./alpha.txt"'], cursorLine: 0, cursorCol: 12 });
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "forced path completion inside delimiters should be handled by path picker");
  }

  console.log("path-picker autocomplete tests passed");
})();
