/**
 * Tests for pick-path.ts - interactive path browser
 *
 * Tests the non-interactive parts via --quick mode (glob pattern matching)
 * and by loading the module via the same jiti setup as index.test.cjs.
 */

const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createRequire } = require("module");

// ── Load jiti from pi's bundled location ───────────────────────────
const piRequire = createRequire(
  "/opt/homebrew/Cellar/pi-coding-agent/" +
  require("fs").readdirSync("/opt/homebrew/Cellar/pi-coding-agent/").filter(f => f.match(/^\d+\.\d+\.\d+$/)).sort().at(-1) +
  "/libexec/lib/node_modules/@earendil-works/pi-coding-agent/package.json"
);
const { createJiti } = piRequire("jiti");

/**
 * Run pick-path.ts in --quick mode with a glob pattern.
 * Returns the list of matching file paths (relative to cwd).
 */
function runQuickGlob(cwd, pattern) {
  const stdout = execSync(
    `node --experimental-strip-types "${__dirname}/pick-path.ts" --quick "${pattern}"`,
    { cwd, timeout: 5000, encoding: "utf8" },
  );
  return stdout.trim().split("\n").filter(Boolean);
}

/**
 * Set up a temporary directory with a known file structure.
 */
function createTempFs(structure) {
  const dir = mkdtempSync(join(tmpdir(), "pick-path-test-"));
  for (const filePath of structure) {
    const full = join(dir, filePath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "", "utf8");
  }
  return dir;
}

// ── Tests ──────────────────────────────────────────────────────────

(async () => {
  // Test 1: Basic glob matching - find *.txt files
  {
    const dir = createTempFs([
      "a.txt",
      "b.txt",
      "c.log",
      "nested/d.txt",
      "nested/deep/e.txt",
    ]);
    const results = runQuickGlob(dir, "**/*.txt");
    assert.ok(results.includes("a.txt"), "should find a.txt");
    assert.ok(results.includes("b.txt"), "should find b.txt");
    assert.ok(results.includes("nested/d.txt"), "should find nested/d.txt");
    assert.equal(results.filter(f => f.endsWith(".log")).length, 0, "should not include .log files");
    assert.equal(results.filter(f => f === "c.log").length, 0, "should not include c.log");
    console.log("  ✓ glob **/*.txt");
  }

  // Test 2: Glob matching with * wildcard
  {
    const dir = createTempFs([
      "foo.txt",
      "bar.txt",
      "baz.log",
    ]);
    const results = runQuickGlob(dir, "*.txt");
    assert.equal(results.length, 2, "should match two .txt files");
    assert.ok(results.includes("foo.txt"));
    assert.ok(results.includes("bar.txt"));
    assert.equal(results.filter(f => f.endsWith(".log")).length, 0);
    console.log("  ✓ glob *.txt");
  }

  // Test 3: Glob matching with ? wildcard
  {
    const dir = createTempFs([
      "cat.txt",
      "car.txt",
      "cab.txt",
      "ca.txt",
      "dog.txt",
    ]);
    const results = runQuickGlob(dir, "ca?.txt");
    assert.equal(results.length, 3, "should match ca(t|r|b).txt");
    assert.ok(results.includes("cat.txt"));
    assert.ok(results.includes("car.txt"));
    assert.ok(results.includes("cab.txt"));
    assert.equal(results.includes("ca.txt"), false, "should not match ca.txt (too short)");
    assert.equal(results.includes("dog.txt"), false, "should not match dog.txt");
    console.log("  ✓ glob ca?.txt");
  }

  // Test 4: Glob deep directory traversal
  {
    const dir = createTempFs([
      "src/index.ts",
      "src/utils/helper.ts",
      "src/utils/deep/nested.ts",
      "README.md",
    ]);
    const results = runQuickGlob(dir, "src/**/*.ts");
    assert.equal(results.length, 3, "should find all .ts files under src/");
    assert.ok(results.includes("src/index.ts"));
    assert.ok(results.includes("src/utils/helper.ts"));
    assert.ok(results.includes("src/utils/deep/nested.ts"));
    assert.equal(results.includes("README.md"), false);
    console.log("  ✓ glob src/**/*.ts");
  }

  // Test 5: Hidden files are excluded by default
  {
    const dir = createTempFs([
      "visible.txt",
      ".hidden.txt",
      "normal.txt",
    ]);
    const results = runQuickGlob(dir, "*");
    assert.ok(results.includes("visible.txt"), "should include visible.txt");
    assert.ok(results.includes("normal.txt"), "should include normal.txt");
    assert.equal(results.includes(".hidden.txt"), false, "should not include hidden files by default");
    console.log("  ✓ hidden files excluded");
  }

  // Test 6: Empty directory returns no results
  {
    const dir = mkdtempSync(join(tmpdir(), "pick-path-empty-"));
    const results = runQuickGlob(dir, "**/*");
    assert.equal(results.length, 0, "empty dir should return no results");
    console.log("  ✓ empty directory");
  }

  // Test 7: Pattern with no matches returns empty
  {
    const dir = createTempFs(["readme.md"]);
    const results = runQuickGlob(dir, "*.js");
    assert.equal(results.length, 0, "no matching files should return empty");
    console.log("  ✓ no matches returns empty");
  }

  // Test 8: Symlink cycle does not cause infinite loop
  {
    const dir = createTempFs(["actual.txt"]);
    // Create a self-referencing symlink
    try {
      symlinkSync(".", join(dir, "self"), "dir");
      symlinkSync("..", join(dir, "self", "up"), "dir");
    } catch {
      console.log("  ⚠ symlink cycle test skipped (permissions)");
      // Skip this test if we can't create the symlink
    }

    // This should complete without hanging despite the cycle
    const results = runQuickGlob(dir, "**/*");
    // Should still list actual.txt, but not recurse infinitely
    assert.ok(results.includes("actual.txt"), "should list actual files");
    assert.ok(results.length >= 1, "should return results without hanging");
    console.log("  ✓ symlink cycle handled (no infinite loop)");
  }

  console.log("\n✓ all pick-path.ts tests passed");
})();

