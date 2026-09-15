import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every hand-written file in the repository, which is what the style gate
// covers. `packages/<name>/package.json` and the generated CHANGELOG files are
// deliberately absent: they are not hand-written.
const formatTargets = [
  'packages/*/lib/**/*.ts',
  'packages/*/index.ts',
  'packages/*/__tests__/**/*.mjs',
  'scripts/*.mjs',
  'test/*.mjs',
];

// The linter only inspects the paths biome.json allows, so the probe has to sit
// inside that scope. The name avoids the `*.test.mjs` glob `pnpm test` runs, and
// the file is removed as soon as the assertion is done with it.
const probe = join(root, 'test', '_style-gate-probe.mjs');

/**
 * Run a binary from the repository's own node_modules, so the test exercises
 * the pinned tooling rather than whatever happens to be on PATH.
 *
 * @param {string} bin
 * @param {string[]} args
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run(bin, args) {
  const executable = join(root, 'node_modules', '.bin', bin);

  assert.ok(existsSync(executable), `${bin} is not installed at the repository root`);

  return spawnSync(executable, args, { cwd: root, encoding: 'utf8' });
}

test('prettier accepts every hand-written source file', () => {
  const result = run('prettier', ['--check', ...formatTargets]);

  assert.equal(result.status, 0, `prettier --check reported unformatted files:\n${result.stdout}${result.stderr}`);
});

test('the linter reports a violation instead of being a placeholder', () => {
  try {
    writeFileSync(probe, 'debugger;\n', 'utf8');

    const result = run('biome', ['lint', '--config-path', join(root, 'biome.json'), probe]);
    const output = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.status, 0, `the linter accepted a file it should reject:\n${output}`);
    assert.match(output, /noDebugger/, 'the linter reported nothing that names the violated rule');
  } finally {
    rmSync(probe, { force: true });
  }
});
