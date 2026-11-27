#!/usr/bin/env node
/**
 * typecheck-all.mjs - run every package's `typecheck` script and aggregate results.
 *
 *   node scripts/typecheck-all.mjs
 *
 * The packages under packages/ are standalone pnpm projects and the root is a
 * script runner rather than a workspace, so this walks the directory the same
 * way test-all.mjs does. A package with no `typecheck` script is skipped.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PACKAGES = join(ROOT, 'packages');

const script = 'typecheck';

const packages = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let pass = 0;
let fail = 0;
const failures = [];

console.log('═══ typecheck-all ═══\n');

for (const pkg of packages) {
  const pkgJsonPath = join(PACKAGES, pkg, 'package.json');
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
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
  // The script calls a binary the package installed, so its own .bin directory
  // has to come first on PATH. `pnpm run` would do this, but the walk here runs
  // the script text directly, as test-all.mjs does.
  const binDir = join(PACKAGES, pkg, 'node_modules', '.bin');
  const result = spawnSync(cmd, {
    cwd: join(PACKAGES, pkg),
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` },
  });

  if (result.status === 0) {
    console.log('✅');
    pass++;
  } else {
    console.log('❌');
    fail++;
    failures.push(pkg);
    const tail = `${result.stdout}\n${result.stderr}`.split('\n').slice(-25).join('\n');
    process.stdout.write(`    ── tail ──\n${tail}\n`);
  }
}

console.log(`\n═══ result: ${pass} ok, ${fail} failed ═══`);

if (failures.length) {
  console.log('failed:', failures.join(', '));
  process.exit(1);
}
