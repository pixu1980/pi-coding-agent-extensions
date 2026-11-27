/**
 * pi-lyceum - source egress guard
 *
 * This package opens exactly one connection, `GET /models`, and it does so from
 * one module. The test pins both facts at the source level, so a future change
 * that adds a second network path, a process spawn, a filesystem write or a
 * different host fails here instead of shipping.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sources = [
  join(packageRoot, 'index.ts'),
  ...readdirSync(join(packageRoot, 'lib'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(packageRoot, 'lib', name)),
];

// Hosts a comment or a constant may name. `lyceum.technology` is the public
// site the bundled catalog snapshot was read from; the API host is the only one
// a request can reach, which `_catalog.test.mjs` asserts separately.
const documentedHosts = new Set(['api.lyceum.technology', 'lyceum.technology', 'docs.lyceum.technology']);

/**
 * @param {string} file absolute path
 * @returns {string} file contents
 */
function read(file) {
  return readFileSync(file, 'utf8');
}

/**
 * @param {string} file absolute path
 * @returns {string} path relative to the package root
 */
function relative(file) {
  return file.slice(packageRoot.length);
}

describe('source egress', () => {
  it('names no host outside the documented allowlist', () => {
    const offenders = [];

    for (const file of sources) {
      for (const match of read(file).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1].toLowerCase();

        if (!documentedHosts.has(host)) {
          offenders.push(`${relative(file)}: ${host}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('reaches the network from the discovery module only', () => {
    const callers = sources.filter((file) => /\bfetch\b/.test(read(file))).map(relative);

    assert.deepEqual(callers, ['lib/_discovery.ts']);
  });

  it('spawns no process and writes no file', () => {
    const forbidden = [/child_process/, /\bexecFile\s*\(/, /\bexecSync\s*\(/, /\bspawn\s*\(/, /\bwriteFile\s*\(/];
    const offenders = [];

    for (const file of sources) {
      const text = read(file);

      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          offenders.push(`${relative(file)}: ${pattern}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it('contains no environment-variable fallback for the key', () => {
    for (const file of sources) {
      assert.ok(!/process\.env/.test(read(file)), `${relative(file)} must not read the environment`);
    }
  });
});
