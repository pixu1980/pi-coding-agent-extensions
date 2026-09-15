import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(root, 'packages');
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

// pi-mcp is a fork of pi-mcp-adapter, so its LICENSE keeps the upstream
// copyright holder rather than this repository's own. Every other package is
// original work and must ship the root LICENSE byte for byte. Overwriting the
// fork's notice would drop a copyright line the license requires us to keep,
// so the fork is pinned here instead.
const forkCopyrights = new Map([['pi-mcp', 'Copyright (c) 2026 Nico Bailon']]);

const rootLicense = readFileSync(join(root, 'LICENSE'), 'utf8');

test('every published package ships a LICENSE file', () => {
  for (const packageDir of packageDirs) {
    assert.ok(existsSync(join(packagesDir, packageDir, 'LICENSE')), `${packageDir} is missing LICENSE`);
  }
});

test('every published package lists LICENSE in its files array', () => {
  for (const packageDir of packageDirs) {
    const manifest = JSON.parse(readFileSync(join(packagesDir, packageDir, 'package.json'), 'utf8'));

    assert.ok(
      manifest.files?.includes('LICENSE'),
      `${packageDir} does not list LICENSE in files, so npm is free to drop it from the tarball`
    );
  }
});

test('every LICENSE grants permission, disclaims warranty and names a holder', () => {
  for (const packageDir of packageDirs) {
    const license = readFileSync(join(packagesDir, packageDir, 'LICENSE'), 'utf8');

    assert.match(
      license,
      /Permission is hereby granted, free of charge/,
      `${packageDir} LICENSE is missing the permission grant`
    );
    assert.match(
      license,
      /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/,
      `${packageDir} LICENSE is missing the warranty disclaimer`
    );
    assert.match(license, /Copyright \(c\) \d{4} \S/, `${packageDir} LICENSE names no copyright holder`);
  }
});

test('original packages ship the root LICENSE unchanged', () => {
  for (const packageDir of packageDirs) {
    if (forkCopyrights.has(packageDir)) {
      continue;
    }

    assert.equal(
      readFileSync(join(packagesDir, packageDir, 'LICENSE'), 'utf8'),
      rootLicense,
      `${packageDir} LICENSE must match the root LICENSE byte for byte`
    );
  }
});

test('forks keep the upstream copyright holder they inherited', () => {
  for (const [packageDir, upstreamCopyright] of forkCopyrights) {
    const license = readFileSync(join(packagesDir, packageDir, 'LICENSE'), 'utf8');

    assert.ok(
      license.includes(upstreamCopyright),
      `${packageDir} dropped the upstream copyright notice it is required to retain`
    );
  }
});
