import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(root, 'packages');

const manifests = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
  .map((entry) => ({
    dir: entry.name,
    json: JSON.parse(readFileSync(join(packagesDir, entry.name, 'package.json'), 'utf8')),
  }));

test('every package ships its generated changelog in the tarball', () => {
  for (const { dir, json } of manifests) {
    assert.ok(json.files?.includes('CHANGELOG.md'), `${dir} must list CHANGELOG.md in files`);
    assert.ok(existsSync(join(packagesDir, dir, 'CHANGELOG.md')), `${dir} must ship CHANGELOG.md`);
  }
});
