import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureNpmAuthentication, standardVersionCommand } from '../scripts/release-helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('runs the repository-installed commit-and-tag-version binary', () => {
  assert.equal(
    standardVersionCommand('/repo', '@scope/package', false),
    '"/repo/node_modules/.bin/commit-and-tag-version" --no-verify --tag-prefix "@scope/package@"'
  );
});

test('adds dry-run when requested', () => {
  assert.equal(
    standardVersionCommand('/repo', 'package', true),
    '"/repo/node_modules/.bin/commit-and-tag-version" --dry-run --tag-prefix "package@"'
  );
});

test('keeps the configured version for an untagged first release', () => {
  assert.equal(
    standardVersionCommand('/repo', 'package', false, true),
    '"/repo/node_modules/.bin/commit-and-tag-version" --first-release --no-verify --tag-prefix "package@"'
  );
});

test('checks npm authentication without logging in when already authenticated', () => {
  const calls = [];

  ensureNpmAuthentication({
    whoami: () => calls.push('whoami'),
    login: () => calls.push('login'),
  });

  assert.deepEqual(calls, ['whoami']);
});

test('asks the user to log in when npm authentication is missing', () => {
  const calls = [];
  const messages = [];
  let authenticated = false;

  ensureNpmAuthentication({
    whoami: () => {
      calls.push('whoami');
      if (!authenticated) throw new Error('not logged in');
    },
    login: () => {
      calls.push('login');
      authenticated = true;
    },
    log: (message) => messages.push(message),
  });

  assert.deepEqual(calls, ['whoami', 'login', 'whoami']);
  assert.deepEqual(messages, ['⚠  npm not authenticated. Starting npm login...']);
});

test('fails when npm login does not authenticate the user', () => {
  assert.throws(
    () =>
      ensureNpmAuthentication({
        whoami: () => {
          throw new Error('not logged in');
        },
        login: () => {},
      }),
    /npm login failed/
  );
});

test('publishes packages locally from the release process', () => {
  const source = readFileSync(`${ROOT}/scripts/release.mjs`, 'utf8');

  assert.match(source, /execIn\(pkgPath, `npm publish --access public`/);
  assert.doesNotMatch(source, /GitHub Actions/);
});

test('does not depend on a GitHub Actions publishing workflow', () => {
  assert.equal(existsSync(`${ROOT}/.github/workflows/publish.yml`), false);
});
