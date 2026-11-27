/**
 * pi-statusline - git hook isolation test (OSS-24)
 *
 * The fixtures in this package run `git commit` in a temp repository. A
 * contributor's global `core.hooksPath` puts their own hooks in the way: a
 * commit-msg hook that rejects the fixture message fails eight tests that have
 * nothing to do with git hooks.
 *
 * This suite proves the isolation instead of trusting it. It points
 * `GIT_CONFIG_GLOBAL` at a config whose `commit-msg` hook exits 1, shows that a
 * plain commit fails there, and then shows that the fixture command used by the
 * other helpers commits anyway.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** A temp repository with its own identity, ready for one commit. */
function makeTempRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Tester']);
  writeFileSync(join(dir, 'file.txt'), 'hello\n');
  git(dir, ['add', '.']);

  return dir;
}

/** Run git in a directory and return its exit code, never throwing. */
function gitStatus(dir, args) {
  try {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

    return 0;
  } catch (error) {
    return typeof error.status === 'number' ? error.status : 1;
  }
}

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

/**
 * A global git config that a contributor might have: every commit runs a
 * `commit-msg` hook that exits 1.
 */
function poisonedGlobalConfig() {
  const home = mkdtempSync(join(tmpdir(), 'pi-statusline-hooks-home-'));
  const hooks = join(home, 'hooks');

  mkdirSync(hooks);
  writeFileSync(join(hooks, 'commit-msg'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(hooks, 'commit-msg'), 0o755);

  const configPath = join(home, 'gitconfig');

  writeFileSync(configPath, `[core]\n\thooksPath = ${hooks}\n`);

  return configPath;
}

/** Run `fn` with GIT_CONFIG_GLOBAL pointing at `configPath`. */
function withGlobalConfig(configPath, fn) {
  const previous = process.env.GIT_CONFIG_GLOBAL;

  process.env.GIT_CONFIG_GLOBAL = configPath;

  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previous;
    }
  }
}

test('git hooks: the poisoned global commit-msg hook rejects a plain commit', () => {
  const configPath = poisonedGlobalConfig();

  withGlobalConfig(configPath, () => {
    const dir = makeTempRepo('pi-statusline-hooks-plain-');

    assert.notEqual(gitStatus(dir, ['commit', '-qm', 'init']), 0, 'the hook must fail the plain commit');
  });
});

test('git hooks: the fixture commit runs no hook and succeeds', () => {
  const configPath = poisonedGlobalConfig();

  withGlobalConfig(configPath, () => {
    const dir = makeTempRepo('pi-statusline-hooks-fixture-');

    assert.equal(gitStatus(dir, ['-c', 'core.hooksPath=', 'commit', '-qm', 'test: fixture']), 0);
  });
});
