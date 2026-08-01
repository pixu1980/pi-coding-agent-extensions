import assert from 'node:assert/strict';
import test from 'node:test';

import { standardVersionCommand } from '../scripts/release-helpers.mjs';

test('runs the repository-installed standard-version binary', () => {
  assert.equal(
    standardVersionCommand('/repo', '@scope/package', false),
    '"/repo/node_modules/.bin/standard-version" --no-verify --tag-prefix "@scope/package@"',
  );
});

test('adds dry-run when requested', () => {
  assert.equal(
    standardVersionCommand('/repo', 'package', true),
    '"/repo/node_modules/.bin/standard-version" --dry-run --tag-prefix "package@"',
  );
});
