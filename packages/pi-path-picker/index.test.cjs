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
  // ── Outside delimiters: always return null ───────────────────
  //
  // Il path picker NON deve mai interferire fuori dagli apici.
  // Ritorna sempre null per lasciare che pi chiami direttamente il
  // provider nativo (comandi /model, @file, argomenti, ecc.).

  // Test 1: `/` at start of line → null (non interferisce con comandi pi.dev)
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal, force: false });
    assert.equal(suggestions, null, "/ at start of line must return null");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "must not delegate / at start of line");
  }

  // Test 2: `/` after space → null
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions([" /"], 0, 2, { signal: new AbortController().signal, force: false });
    assert.equal(suggestions, null, "/ after space must return null");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "must not delegate / after space");
  }

  // Test 3: `~` trigger → null (tilde fuori apici è raro, non interferiamo)
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(["~"], 0, 1, { signal: new AbortController().signal, force: false });
    assert.equal(suggestions, null, "~ trigger outside delimiters must return null");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "must not delegate ~");
  }

  // Test 4: force=true outside → null (stessa policy, nessuna eccezione)
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal, force: true });
    assert.equal(suggestions, null, "force=true outside delimiters must also return null");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "must not delegate on TAB");
  }

  // Test 5: shouldTriggerFileCompletion → always returns true (menu close fix)
  {
    const { provider, calls } = createProvider();
    const result = provider.shouldTriggerFileCompletion(["plain text"], 0, 10);
    assert.equal(result, true, "shouldTriggerFileCompletion must return true");
    // Implementation always returns true directly (no delegation) to ensure
    // pi re-queries getSuggestions on every keystroke, fixing the bug where
    // deleting a quote character does NOT close the menu.
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0, "shouldTriggerFileCompletion must NOT delegate");
  }

  // Test 6: applyCompletion outside → delegate to current
  {
    const { provider, calls } = createProvider();
    const result = provider.applyCompletion(["/mod"], 0, 4, { value: "/model", label: "model" }, "/mod");
    assert.deepEqual(result, { lines: ["/model "], cursorLine: 0, cursorCol: 7 });
    assert.equal(calls.filter(([name]) => name === "applyCompletion").length, 1, "applyCompletion outside must delegate");
  }

  // ── Inside delimiters: path autocomplete, no delegation ──

  // Test 7: TAB inside quotes with ./ → path autocomplete
  {
    const cwd = mkdtempSync(join(tmpdir(), "path-picker-cwd-"));
    writeFileSync(join(cwd, "alpha.txt"), "");
    const { provider, calls } = createProvider(cwd);
    const suggestions = await provider.getSuggestions(['"./"'], 0, 3, { signal: new AbortController().signal, force: true });
    assert.notEqual(suggestions, null, "TAB inside delimiters must trigger path picker");
    assert.equal(suggestions.prefix, "./");
    assert.equal(suggestions.items.some((item) => item.value === "./alpha.txt"), true, "should find alpha.txt");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "no delegation inside quotes");
  }

  // Test 8: TAB inside quotes with / → absolute path
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(['"/"'], 0, 2, { signal: new AbortController().signal, force: true });
    assert.notEqual(suggestions, null, 'TAB after "/" inside quotes must trigger path picker');
    assert.equal(suggestions.prefix, "/");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "no delegation for absolute path inside quotes");
  }

  // Test 9: `~` trigger inside quotes → immediate path autocomplete
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(['"~/"'], 0, 3, { signal: new AbortController().signal, force: false });
    assert.notEqual(suggestions, null, '~ trigger inside quotes must show path picker');
    assert.equal(suggestions.prefix, "~/");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "no delegation for ~ inside quotes");
  }

  // Test 10: `/` trigger inside quotes → immediate path autocomplete
  {
    const { provider, calls } = createProvider();
    const suggestions = await provider.getSuggestions(['"/"'], 0, 2, { signal: new AbortController().signal, force: false });
    assert.notEqual(suggestions, null, '/ trigger inside quotes must show path picker immediately');
    assert.equal(suggestions.prefix, "/");
    assert.equal(calls.filter(([name]) => name === "getSuggestions").length, 0, "no delegation for / inside quotes");
  }

  // Test 11: shouldTriggerFileCompletion inside with path → true
  {
    const { provider, calls } = createProvider();
    assert.equal(provider.shouldTriggerFileCompletion(['"./s"'], 0, 4), true);
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0, "no delegation for path inside quotes");
  }

  // Test 12: shouldTriggerFileCompletion inside without path → still true (menu close fix)
  {
    const { provider, calls } = createProvider();
    // Even without a path token, return true so pi re-queries
    // getSuggestions, which returns null, closing the menu.
    assert.equal(provider.shouldTriggerFileCompletion(['""'], 0, 1), true);
    assert.equal(calls.filter(([name]) => name === "shouldTriggerFileCompletion").length, 0, "no delegation inside delimiters");
  }

  // Test 13: applyCompletion inside → path replacement works
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
