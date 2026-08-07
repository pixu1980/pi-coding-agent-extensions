#!/usr/bin/env node
/**
 * test-all.mjs - run every package's test suite and aggregate results.
 *
 *   node scripts/test-all.mjs            # run `test` in each package
 *   node scripts/test-all.mjs --coverage # run `test:coverage` instead
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PACKAGES = join(ROOT, "packages");
const useCoverage = process.argv.includes("--coverage");

const script = useCoverage ? "test:coverage" : "test";
const packages = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let pass = 0;
let fail = 0;
const failures = [];

console.log(`═══ test-all ${useCoverage ? "(coverage)" : ""} ═══\n`);

for (const pkg of packages) {
  const pkgJsonPath = join(PACKAGES, pkg, "package.json");
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    console.log(`⚠  ${pkg}: no package.json, skipped`);
    continue;
  }
  const cmd = pkgJson.scripts?.[script];
  if (!cmd) {
    console.log(`⏭  ${pkg}: no "${script}" script`);
    continue;
  }

  process.stdout.write(`── ${pkg}: ${cmd} `);
  const result = spawnSync(cmd, {
    cwd: join(PACKAGES, pkg),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });

  // extract the summary line for a compact report
  const summary = (result.stdout + "\n" + result.stderr)
    .split("\n")
    .filter((l) => /tests |pass |fail |all files/.test(l))
    .slice(0, 4)
    .join(" | ");

  if (result.status === 0) {
    console.log(`✅\n    ${summary || "ok"}`);
    pass++;
  } else {
    console.log(`❌\n    ${summary || "failed"}`);
    fail++;
    failures.push(pkg);
    if (!useCoverage) {
      const tail = (result.stdout + "\n" + result.stderr).split("\n").slice(-25).join("\n");
      process.stdout.write(`    ── tail ──\n${tail}\n`);
    }
  }
}

console.log(`\n═══ risultato: ${pass} ok, ${fail} falliti ═══`);
if (failures.length) {
  console.log("falliti:", failures.join(", "));
  process.exit(1);
}
