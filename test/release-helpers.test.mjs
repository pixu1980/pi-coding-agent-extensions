import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { standardVersionCommand } from '../scripts/release-helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('runs the repository-installed commit-and-tag-version binary', () => {
  assert.equal(
    standardVersionCommand('/repo', '@scope/package', false),
    '"/repo/node_modules/.bin/commit-and-tag-version" --no-verify --tag-prefix "@scope/package@"',
  );
});

test('adds dry-run when requested', () => {
  assert.equal(
    standardVersionCommand('/repo', 'package', true),
    '"/repo/node_modules/.bin/commit-and-tag-version" --dry-run --tag-prefix "package@"',
  );
});

test('keeps the configured version for an untagged first release', () => {
  assert.equal(
    standardVersionCommand('/repo', 'package', false, true),
    '"/repo/node_modules/.bin/commit-and-tag-version" --first-release --no-verify --tag-prefix "package@"',
  );
});

test('does not publish from the local release process', () => {
  const source = readFileSync(`${ROOT}/scripts/release.mjs`, 'utf8');

  assert.doesNotMatch(source, /execIn\(pkgPath, `(?:pnpm|npm) publish/);
  assert.match(source, /GitHub Actions/);
});

test('publishes through npm trusted publishing without token configuration', () => {
  const source = readFileSync(`${ROOT}/.github/workflows/publish.yml`, 'utf8');

  assert.match(source, /id-token:\s*write/);
  assert.match(source, /npm publish\b/);
  const forbiddenAuthNames = [
    ['_', 'auth', 'Token'].join(''),
    ['NPM', '_', 'TOKEN'].join(''),
    ['NPM', '_', 'TOKEM'].join(''),
    ['NODE', '_', 'AUTH', '_', 'TOKEN'].join(''),
  ];
  assert.doesNotMatch(source, new RegExp(forbiddenAuthNames.join('|')));
});
