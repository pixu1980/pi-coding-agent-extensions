import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(root, 'packages');

// @earendil-works/pi-coding-agent and @earendil-works/pi-tui both declare
// `node: >=22.19.0`, and every package here lists one of them as a peer
// dependency, because a pi extension runs inside pi. Nothing in this repository
// can work on an older runtime than the host it loads into.
const requiredNode = '>=22.19.0';

const manifests = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
  .map((entry) => ({
    dir: entry.name,
    json: JSON.parse(readFileSync(join(packagesDir, entry.name, 'package.json'), 'utf8')),
  }));

test('every published package requires the node version pi itself requires', () => {
  for (const { dir, json } of manifests) {
    assert.equal(
      json.engines?.node,
      requiredNode,
      `${dir} must declare engines.node ${requiredNode}, matching its @earendil-works/pi-coding-agent peer`
    );
  }
});

test('every published package declares the metadata npm and the registry need', () => {
  for (const { dir, json } of manifests) {
    assert.equal(json.private, false, `${dir} must stay publishable`);
    assert.equal(json.license, 'MIT', `${dir} must declare its license`);
    assert.ok(json.repository?.directory, `${dir} must point repository.directory at itself`);
    assert.ok(Array.isArray(json.files) && json.files.length > 0, `${dir} must declare a non-empty files array`);
  }
});

test('every package ships its license text and its readme', () => {
  for (const { dir, json } of manifests) {
    for (const required of ['README.md', 'LICENSE']) {
      assert.ok(json.files.includes(required), `${dir} must list ${required} in files`);
      assert.ok(existsSync(join(packagesDir, dir, required)), `${dir} must actually ship ${required}`);
    }
  }
});
