import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  changedFilesSinceTag,
  ensureNpmAuthentication,
  ghReleaseCommand,
  isReleaseTriggerFile,
  releaseSummaryLines,
  standardVersionCommand,
} from '../scripts/release-helpers.mjs';

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

test('never asks commit-and-tag-version to sign the tag', () => {
  // An unsigned tag is a decision, not an oversight: commit-and-tag-version
  // uses `git tag -a` unless --sign is passed, and a signed tag would require
  // every maintainer to hold a signing key. The flag must never appear.
  const commands = [
    standardVersionCommand('/repo', '@scope/package', false),
    standardVersionCommand('/repo', '@scope/package', true),
    standardVersionCommand('/repo', '@scope/package', false, true),
    standardVersionCommand('/repo', '@scope/package', true, true),
  ];

  for (const command of commands) {
    assert.doesNotMatch(command, /--sign/, command);
    assert.doesNotMatch(command, / -s( |$)/, command);
  }
});

test('builds a GitHub release note for the tag it documents', () => {
  assert.equal(
    ghReleaseCommand('@pixu1980/pi-ask', '0.3.0', 'CHANGELOG.md'),
    'gh release create "@pixu1980/pi-ask@0.3.0" --title "@pixu1980/pi-ask@0.3.0" --notes-file "CHANGELOG.md"'
  );
});

test('creates the release note after the tag push and before the publish', () => {
  const source = readFileSync(`${ROOT}/scripts/release.mjs`, 'utf8');
  const tagPush = source.indexOf('git push --follow-tags origin main');
  const releaseNote = source.indexOf('execIn(pkgPath, ghReleaseCommand(');
  const publish = source.indexOf('execIn(pkgPath, `npm publish --access public`');

  assert.ok(tagPush > -1, 'release.mjs must push the tag');
  assert.ok(releaseNote > tagPush, 'the note must follow the tag it points at');
  assert.ok(publish > releaseNote, 'a failed publish must not leave a note pointing at nothing');
});

test('prints the release note command in a dry run', () => {
  const source = readFileSync(`${ROOT}/scripts/release.mjs`, 'utf8');

  assert.match(source, /\[dry-run\] \$\{ghReleaseCommand\(/);
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

test('skips a deprecated package instead of republishing it', () => {
  const source = readFileSync(`${ROOT}/scripts/release.mjs`, 'utf8');

  assert.match(source, /if \(pkgJson\.deprecated\)/, 'release.mjs must branch on a package deprecation');
  assert.match(source, /deprecated, skipped/, 'the branch must skip the package, not merely log it');
});

test('a dry run reports how many packages it would release', () => {
  const summary = releaseSummaryLines({
    released: 0,
    wouldRelease: 3,
    skipped: 1,
    total: 8,
    dryRun: true,
  }).join('\n');

  assert.match(summary, /would release: 3/);
  assert.doesNotMatch(summary, /released: {5}0/);
});

test('a real run reports how many packages it released', () => {
  const summary = releaseSummaryLines({
    released: 3,
    wouldRelease: 0,
    skipped: 1,
    total: 8,
    dryRun: false,
  }).join('\n');

  assert.match(summary, /released: {5}3/);
  assert.doesNotMatch(summary, /would release/);
});

// ── changedFilesSinceTag ───────────────────────────────────────────────
// Builds a throwaway git repo that mirrors the monorepo layout, so the
// detection logic is exercised against real `git diff` output.

/**
 * Creates a temp git repo with two packages and returns a bound runner.
 * Layout: packages/a (lib.js + CHANGELOG.md) and packages/b (lib.js).
 * A tag `pkga@0.1.0` is placed on the first commit.
 */
function makeFixtureRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'release-detect-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' }).trim();

  run('git init -b main');
  run('git config user.email test@example.com');
  run('git config user.name test');
  // The fixture commits messages that are deliberately not Conventional
  // Commits, so a maintainer's global core.hooksPath would reject them here.
  // Point the temp repo at a hooks directory that does not exist.
  run('git config core.hooksPath .git/no-hooks');

  mkdirSync(join(dir, 'packages/a'), { recursive: true });
  mkdirSync(join(dir, 'packages/b'), { recursive: true });
  writeFileSync(join(dir, 'packages/a/lib.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'packages/a/CHANGELOG.md'), '# Changelog\n');
  writeFileSync(join(dir, 'packages/b/lib.js'), 'export const b = 1;\n');

  run('git add .');
  run('git commit -m c1');
  run('git tag pkga@0.1.0');

  t.after(() => execSync(`rm -rf "${dir}"`));
  return { dir, run };
}

function touch(dir, relPath, content) {
  writeFileSync(join(dir, relPath), content);
}

test('isReleaseTriggerFile ignores auto-generated CHANGELOG.md', () => {
  assert.equal(isReleaseTriggerFile('packages/a/CHANGELOG.md'), false);
  assert.equal(isReleaseTriggerFile('packages/a/lib/_helpers.ts'), true);
  assert.equal(isReleaseTriggerFile('packages/a/README.md'), true);
});

test('CHANGELOG.md-only changes do not trigger a release (the last-run bug)', (t) => {
  const repo = makeFixtureRepo(t);
  touch(repo.dir, 'packages/a/CHANGELOG.md', '# Changelog\nrewritten wording without new functionality\n');
  repo.run('git add .');
  repo.run('git commit -m "docs: rewrite changelog wording"');

  assert.deepEqual(changedFilesSinceTag('pkga@0.1.0', 'packages/a', repo.run), []);
});

test('source changes since the last tag do trigger a release', (t) => {
  const repo = makeFixtureRepo(t);
  touch(repo.dir, 'packages/a/lib.js', 'export const a = 2;\n');
  repo.run('git add .');
  repo.run('git commit -m c2');

  assert.deepEqual(changedFilesSinceTag('pkga@0.1.0', 'packages/a', repo.run), ['packages/a/lib.js']);
});

test('changes in other packages do not trigger a release', (t) => {
  const repo = makeFixtureRepo(t);
  touch(repo.dir, 'packages/b/lib.js', 'export const b = 2;\n');
  repo.run('git add .');
  repo.run('git commit -m c2');

  assert.deepEqual(changedFilesSinceTag('pkga@0.1.0', 'packages/a', repo.run), []);
});

test('unknown tag returns null (caller errs on the side of releasing)', (t) => {
  const repo = makeFixtureRepo(t);
  assert.equal(changedFilesSinceTag('missing@9.9.9', 'packages/a', repo.run), null);
});
