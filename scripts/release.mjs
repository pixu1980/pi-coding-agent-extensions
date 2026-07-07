#!/usr/bin/env node

/**
 * release.mjs
 *
 * Rilascia TUTTE le estensioni (package non-privati in packages/) MA solo
 * quelle che hanno modifiche dall'ultimo tag git (identificato come
 * <package-name>@<current-version>).
 *
 * Per ogni package modificato:
 *   1. standard-version --no-verify --tag-prefix "<name>@"
 *      → bump semver, CHANGELOG, commit + tag
 *   2. npm publish
 *
 * Uso:
 *   node scripts/release.mjs
 *   node scripts/release.mjs --dry-run            (solo simulazione)
 *   node scripts/release.mjs --force / -f         (forza release anche senza modifiche)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');
const isForced = process.argv.includes('--force') || process.argv.includes('-f');

// ── Helper: esegue comando e ritorna stdout, oppure lancia errore ──────
function exec(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function execIn(pkgDir, cmd, opts = {}) {
  return execSync(cmd, { cwd: pkgDir, stdio: 'inherit', encoding: 'utf-8', ...opts });
}

// ── Helper: git tag esiste? ──────────────────────────────────────────────
function tagExists(tag) {
  try {
    exec(`git rev-parse "${tag}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── Helper: ci sono modifiche nel package da quando è stato taggato? ────
function packageHasChangesSinceTag(tag, pkgDir) {
  try {
    exec(`git diff --quiet "${tag}" -- "${pkgDir}"`, { stdio: 'pipe' });
    return false; // nessuna modifica
  } catch {
    return true;  // ci sono modifiche
  }
}

// ── Helper: working tree pulito? ─────────────────────────────────────────
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
console.log('  release — rilascio estensioni');
console.log(`  dry-run: ${isDryRun ? '✓' : '✗'}`);
console.log(`  force:   ${isForced ? '✓' : '✗'}`);
console.log('═══════════════════════════════════════════\n');

if (!isWorkingTreeClean()) {
  if (isDryRun) {
    console.log('⚠  Working tree sporco — dry-run prosegue lo stesso (nessuna modifica reale).\n');
  } else {
    console.error('✗ Working tree non pulito. Committa o stash prima di rilasciare.');
    process.exit(1);
  }
}

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let released = 0;
let skipped = 0;

for (const pkg of packages) {
  const pkgPath = join(PACKAGES_DIR, pkg);
  const pkgJsonPath = join(pkgPath, 'package.json');

  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  } catch {
    console.log(`⚠  ${pkg}: package.json non valido, saltato`);
    continue;
  }

  if (pkgJson.private) {
    console.log(`⏭  ${pkgJson.name}: private, saltato`);
    skipped++;
    continue;
  }

  const name = pkgJson.name;
  const version = pkgJson.version;
  const tag = `${name}@${version}`;

  console.log(`\n── ${name} ────────────────────────────────`);
  console.log(`   versione corrente: ${version}`);

  // Controlla se il tag esiste già
  if (tagExists(tag)) {
    console.log(`   tag trovato: ${tag}`);

    if (!packageHasChangesSinceTag(tag, `packages/${pkg}`)) {
      if (isForced) {
        console.log(`   ⚑ nessuna modifica ma --force presente, procedo comunque`);
      } else {
        console.log(`   ✓ nessuna modifica, saltato`);
        skipped++;
        continue;
      }
    }
    console.log(`   ↻ modifiche rilevate, procedo con rilascio`);
  } else {
    console.log(`   ⚑ nessun tag trovato, rilascio iniziale`);
  }

  // ── Rilascio ──
  if (isDryRun) {
    console.log(`   [dry-run] standard-version --tag-prefix "${name}@"`);
    execIn(pkgPath, `npx standard-version --dry-run --tag-prefix "${name}@"`, { stdio: 'inherit' });
    console.log(`   [dry-run] pnpm publish (saltato)`);
  } else {
    try {
      // Bump + tag
      execIn(pkgPath, `npx standard-version --no-verify --tag-prefix "${name}@"`, { stdio: 'inherit' });

      // Push tag
      console.log(`   → push tag...`);
      execIn(pkgPath, `git push --follow-tags origin main`, { stdio: 'inherit' });

      // Pubblica
      console.log(`   → pnpm publish...`);
      execIn(pkgPath, `pnpm publish`, { stdio: 'inherit' });

      released++;
      console.log(`   ✅ ${name} pubblicato!`);
    } catch (err) {
      console.error(`   ❌ Errore durante il rilascio di ${name}:`, err.message);
      process.exit(1);
    }
  }
}

console.log('\n═══════════════════════════════════════════');
console.log(`  Riepilogo:`);
console.log(`  • rilasciati:   ${released}`);
console.log(`  • saltati:      ${skipped}`);
console.log(`  • totale pkg:   ${packages.length}`);
console.log('═══════════════════════════════════════════\n');
