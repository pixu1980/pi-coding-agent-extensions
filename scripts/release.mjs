#!/usr/bin/env node

/**
 * release.mjs
 *
 * Releases ALL extensions (non-private packages in packages/) but ONLY
 * those that have changes since their last git tag (identified as
 * <package-name>@<current-version>).
 *
 * For each changed package:
 *   1. Local commit-and-tag-version --no-verify --tag-prefix "<name>@"
 *      → bump semver, CHANGELOG, commit + tag
 *   2. Push the tag
 *   3. npm publish locally with the user's npm credentials
 *
 * Usage:
 *   node scripts/release.mjs
 *   node scripts/release.mjs --dry-run            (simulation only)
 *   node scripts/release.mjs --force / -f         (force release even without changes)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureNpmAuthentication, standardVersionCommand } from './release-helpers.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
const isForced = process.argv.includes('--force') || process.argv.includes('-f');

// ── Helper: runs a command and returns stdout, or throws ──────────────
function exec(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function execIn(pkgDir, cmd, opts = {}) {
  return execSync(cmd, { cwd: pkgDir, stdio: 'inherit', encoding: 'utf-8', ...opts });
}

// ── Helper: does the git tag exist? ────────────────────────────────────
function tagExists(tag) {
  try {
    exec(`git rev-parse "${tag}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── Helper: has the package changed since it was tagged? ──────────────
function packageHasChangesSinceTag(tag, pkgDir) {
  try {
    exec(`git diff --quiet "${tag}" -- "${pkgDir}"`, { stdio: 'pipe' });
    return false; // no changes
  } catch {
    return true; // has changes
  }
}

// ── Helper: is the working tree clean? ─────────────────────────────────
function isWorkingTreeClean() {
  try {
    const status = exec(`git status --porcelain`, { stdio: 'pipe' }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════');
console.log('  release — extension publishing');
console.log(`  dry-run: ${isDryRun ? '✓' : '✗'}`);
console.log(`  force:   ${isForced ? '✓' : '✗'}`);
console.log('═══════════════════════════════════════════\n');

if (!isWorkingTreeClean()) {
  if (isDryRun) {
    console.log('⚠  Working tree is dirty — dry-run proceeds anyway (no real changes).\n');
  } else {
    console.error('✗ Working tree is not clean. Commit or stash before releasing.');
    process.exit(1);
  }
}

if (!isDryRun) {
  try {
    ensureNpmAuthentication({
      whoami: () => exec('npm whoami'),
      login: () =>
        execIn(ROOT, 'npm login', {
          stdio: 'inherit',
        }),
      log: console.log,
    });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let released = 0;
let skipped = 0;

for (const pkg of packages) {
  const pkgPath = join(PACKAGES_DIR, pkg);
  const pkgJsonPath = join(pkgPath, 'package.json');

  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  } catch {
    console.log(`⚠  ${pkg}: invalid package.json, skipped`);
    continue;
  }

  if (pkgJson.private) {
    console.log(`⏭  ${pkgJson.name}: private, skipped`);
    skipped++;
    continue;
  }

  // ── Dual-use validation (npm contentPolicy) ──
  if (pkgJson.contentPolicy === 'dual-use') {
    const disclosurePath = join(pkgPath, 'DISCLOSURE');
    if (!existsSync(disclosurePath)) {
      console.error(`✗ ${pkgJson.name}: contentPolicy=dual-use but DISCLOSURE not found.`);
      console.error(`  Create packages/${pkg}/DISCLOSURE and try again.`);
      process.exit(1);
    }
    console.log(`   🔒 dual-use: DISCLOSURE present ✓`);
    if (!isDryRun) {
      console.log(`   ⚠  Dual-use publishing requires npm authentication with 2FA.`);
      console.log(`   Make sure the npm account has 2FA enabled.`);
    }
  }

  const name = pkgJson.name;
  const version = pkgJson.version;
  const tag = `${name}@${version}`;

  console.log(`\n── ${name} ────────────────────────────────`);
  console.log(`   current version: ${version}`);

  // A missing tag indicates a first release for this version.
  const isFirstRelease = !tagExists(tag);

  // Check whether the tag already exists
  if (!isFirstRelease) {
    console.log(`   tag found: ${tag}`);

    if (!packageHasChangesSinceTag(tag, `packages/${pkg}`)) {
      if (isForced) {
        console.log(`   ⚑ no changes but --force present, proceeding anyway`);
      } else {
        console.log(`   ✓ no changes, skipped`);
        skipped++;
        continue;
      }
    }
    console.log(`   ↻ changes detected, proceeding with release`);
  } else {
    console.log(`   ⚑ no tag found, initial release`);
  }

  // ── Release ──
  if (isDryRun) {
    console.log(`   [dry-run] commit-and-tag-version --tag-prefix "${name}@"`);
    execIn(pkgPath, standardVersionCommand(ROOT, name, true, isFirstRelease), { stdio: 'inherit' });
    console.log(`   [dry-run] npm publish --access public (skipped)`);
  } else {
    try {
      // Bump + tag
      execIn(pkgPath, standardVersionCommand(ROOT, name, false, isFirstRelease), { stdio: 'inherit' });

      // Push tag
      console.log(`   → pushing tag...`);
      execIn(pkgPath, `git push --follow-tags origin main`, { stdio: 'inherit' });

      // Publish locally using the user's npm credentials.
      console.log(`   → npm publish...`);
      execIn(pkgPath, `npm publish --access public`, { stdio: 'inherit' });

      released++;
      console.log(`   ✅ ${name}: published and tag pushed`);
    } catch (err) {
      console.error(`   ❌ Error during release of ${name}:`, err.message);
      process.exit(1);
    }
  }
}

console.log('\n═══════════════════════════════════════════');
console.log(`  Summary:`);
console.log(`  • released:     ${released}`);
console.log(`  • skipped:      ${skipped}`);
console.log(`  • total pkgs:   ${packages.length}`);
console.log('═══════════════════════════════════════════\n');
