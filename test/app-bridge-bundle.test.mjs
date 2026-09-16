import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildAppBridgeSource, OUTPUT_FILE } from '../scripts/build-app-bridge.mjs';

// What the host HTML imports out of the served bundle. If a dependency bump
// changes any of these names, the UI stops loading, so the contract is asserted
// separately from the bytes.
const consumedExports = ['AppBridge', 'PostMessageTransport'];

/**
 * The bundle's exported names, read out of its export statement.
 *
 * @param {string} source
 * @returns {Set<string>}
 */
function exportedNames(source) {
  const names = new Set();

  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of block[1].split(',')) {
      const part = entry.trim();

      if (part === '') {
        continue;
      }

      const aliased = /^[\w$]+\s+as\s+([\w$]+)$/.exec(part);
      names.add(aliased ? aliased[1] : part);
    }
  }

  return names;
}

/**
 * A short fingerprint, so a mismatch reports a hash instead of 688 KB of diff.
 *
 * @param {string} text
 * @returns {string}
 */
function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

test('the committed app bridge bundle is exactly what the build script produces', async () => {
  const committed = readFileSync(OUTPUT_FILE, 'utf8');
  const rebuilt = await buildAppBridgeSource();

  assert.equal(
    fingerprint(committed),
    fingerprint(rebuilt),
    'the committed bundle is stale or hand-edited; run `pnpm build:app-bridge` and commit the result'
  );
});

test('the bundle exports what the host HTML imports', () => {
  const names = exportedNames(readFileSync(OUTPUT_FILE, 'utf8'));

  for (const name of consumedExports) {
    assert.ok(names.has(name), `the host HTML imports ${name}, which the bundle no longer exports`);
  }
});

test('the bundle is self-contained, so a browser can load it', () => {
  const source = readFileSync(OUTPUT_FILE, 'utf8');
  const bareImports = [...source.matchAll(/from\s*["']([^"'.][^"']*)["']/g)].map((match) => match[1]);

  assert.deepEqual(
    bareImports,
    [],
    `a browser cannot resolve these specifiers, so the build is not inlining its dependencies:\n${bareImports.join('\n')}`
  );
});
