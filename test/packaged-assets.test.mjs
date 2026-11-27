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

test('pi-remote ships every icon referenced by its PWA', () => {
  const webDir = join(packagesDir, 'pi-remote', 'web');
  const manifest = JSON.parse(readFileSync(join(webDir, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');

  const references = new Set(manifest.icons.map((icon) => icon.src));

  for (const match of html.matchAll(/<link\b[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) {
    references.add(match[1]);
  }

  assert.ok(references.size > 0, 'expected at least one icon reference');

  for (const reference of references) {
    assert.ok(reference.startsWith('./'), `${reference} must be relative to the PWA`);

    const path = join(webDir, reference);

    assert.ok(existsSync(path), `pi-remote is missing the referenced icon ${reference}`);

    if (reference.endsWith('.png')) {
      const data = readFileSync(path);

      assert.equal(
        data.subarray(0, 8).toString('hex'),
        '89504e470d0a1a0a',
        `${reference} must be a real PNG, not a renamed asset`
      );

      const declared = manifest.icons.find((icon) => icon.src === reference)?.sizes;
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);

      if (declared && declared !== 'any') {
        assert.equal(`${width}x${height}`, declared, `${reference} has the wrong dimensions`);
      }
    }
  }
});
