import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Directories whose contents are not repository prose: two are tool state, and
// docs/ is the audit and review dossier, which quotes the Italian it reports on
// and therefore has to be allowed to contain it.
const ignored = new Set(['.git', '.tokensave', 'node_modules', 'docs']);

// The generated bundle is minified third-party code, not prose.
const generated = new Set(['_app-bridge.bundle.js']);

// Files allowed to contain non-English text, each for a stated reason.
// pi-ask detects the chat language from a stopword list, so its Italian words are
// data the feature matches on, not prose. The file says so in its own header, and
// it keeps its comments in English.
const allowlisted = new Set(['packages/pi-ask/lib/_lang.ts']);

// Words that are unambiguously Italian and have no English homograph. The list is
// deliberately short and every entry was checked against the whole repository to
// confirm it produces no false positive: a guard that fires on correct code
// teaches people to ignore it.
const italian = [
  'aggiunge',
  'almeno',
  'anche',
  'aperti',
  'attenzione',
  'attivato',
  'blocca',
  'cartella',
  'chiude',
  'comandi',
  'comportamento',
  'contiene',
  'dalla',
  'decidere',
  'degli',
  'della',
  'delle',
  'dentro',
  'dopo',
  'errore',
  'esattamente',
  'esclusivamente',
  'espliciti',
  'essere',
  'falliti',
  'fuori',
  'malevoli',
  'nativo',
  'nella',
  'nelle',
  'nessun',
  'nessuna',
  'niente',
  'pacchetti',
  'passando',
  'percorso',
  'perche',
  'preserva',
  'prima',
  'pubblicazione',
  'questo',
  'questa',
  'quotata',
  'regione',
  'richiede',
  'richiesta',
  'risultato',
  'senza',
  'sono',
  'spetta',
  'trattini',
  'tutti',
  'tutte',
  'verificati',
  'viene',
  'vengono',
];

/**
 * Every source and config file the rule covers.
 *
 * @param {string} directory
 * @returns {string[]} absolute paths
 */
function collectFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || generated.has(entry.name)) {
      continue;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...collectFiles(full));
    } else if (/\.(ts|mjs|js|json|ya?ml)$/.test(entry.name) || entry.name === '.npmrc') {
      found.push(full);
    }
  }

  return found;
}

test('every source and config file is written in English', () => {
  const offenders = [];

  for (const file of collectFiles(root)) {
    const repoPath = relative(root, file);

    // This file is the list of words it looks for, so it would always match
    // itself.
    if (repoPath === relative(root, fileURLToPath(import.meta.url)) || allowlisted.has(repoPath)) {
      continue;
    }

    for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      const lowered = line.toLowerCase();
      const matched = italian.filter((word) => new RegExp(`\\b${word}\\b`).test(lowered));

      if (matched.length > 0) {
        offenders.push(`${repoPath}:${index + 1} (${matched.join(', ')})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `this repository writes every artifact except chat in English. These lines are not:\n${offenders.join('\n')}`
  );
});
