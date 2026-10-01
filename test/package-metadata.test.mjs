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
    // A deprecated package is not publishable any more, so the publishability
    // invariants do not apply to it. The deprecation guard below covers it.
    if (json.deprecated) {
      continue;
    }

    assert.equal(json.private, false, `${dir} must stay publishable`);
    assert.equal(json.license, 'MIT', `${dir} must declare its license`);
    assert.ok(json.repository?.directory, `${dir} must point repository.directory at itself`);
    assert.ok(Array.isArray(json.files) && json.files.length > 0, `${dir} must declare a non-empty files array`);
  }
});

// A deprecated package stays on npm so an existing install keeps resolving, but
// it must never gain another version. `deprecated` and `private` in the manifest
// are the declaration; release.mjs is the enforcement, because it is the only
// publish path in this repository. `private` alone would NOT stop a plain
// `npm publish` run from inside the package directory - npm applies that guard
// only to workspace publishes, which is why the release loop is the stop that
// matters and why both are pinned here.
test('a deprecated package is private and the release loop skips it both ways', () => {
  const deprecated = manifests.filter(({ json }) => json.deprecated);

  assert.ok(deprecated.length > 0, 'expected at least one deprecated package for this guard to cover');

  for (const { dir, json } of deprecated) {
    assert.equal(typeof json.deprecated, 'string', `${dir} must carry an npm deprecation message`);
    assert.ok(json.deprecated.length > 0, `${dir} carries an empty deprecation message`);
    assert.equal(json.private, true, `${dir} is deprecated and must also be marked private`);
  }

  const release = readFileSync(join(root, 'scripts', 'release.mjs'), 'utf8');

  assert.match(release, /if \(pkgJson\.private\)/, 'release.mjs must skip a private package');
  assert.match(release, /if \(pkgJson\.deprecated\)/, 'release.mjs must skip a deprecated package');
});

test('every package ships its license text and its readme', () => {
  for (const { dir, json } of manifests) {
    for (const required of ['README.md', 'LICENSE']) {
      assert.ok(json.files.includes(required), `${dir} must list ${required} in files`);
      assert.ok(existsSync(join(packagesDir, dir, required)), `${dir} must actually ship ${required}`);
    }
  }
});

// A deprecated package stays published and installable, but every surface that
// can still suggest it should say it is superseded. The `deprecated` field is
// inert to npm, which flags a version through `npm deprecate`; it is this
// repository's marker, read by scripts/release.mjs so a deprecated package is
// not republished by accident.
test('a deprecated package carries a non-empty reason and no active one does', () => {
  const deprecated = manifests.filter(({ json }) => json.deprecated !== undefined);

  assert.deepEqual(
    deprecated.map(({ dir }) => dir).sort(),
    ['pi-mcp'],
    'pi-mcp is the only package superseded by the host, so only it may be marked deprecated'
  );

  for (const { dir, json } of deprecated) {
    assert.equal(typeof json.deprecated, 'string', `${dir} must explain its deprecation with a string`);
    assert.ok(json.deprecated.trim().length > 0, `${dir} must not carry an empty deprecation reason`);
  }
});
