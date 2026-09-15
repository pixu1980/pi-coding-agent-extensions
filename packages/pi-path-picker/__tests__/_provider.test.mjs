/**
 * pi-path-picker - e2e test suite (autocomplete provider)
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * Drives the extension factory with a mock ExtensionAPI: the provider wraps
 * the native provider and owns path autocomplete inside quote regions.
 *
 * The quotes are intentionally tested in BOTH natural typing states the
 * real TUI produces:
 *   - open pair  `"./` (cursor after the path, no closing quote yet)
 *   - closed pair `"./"` (cursor right after the closing quote)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProvider } from './_helpers.mjs';

const SIG = { signal: new AbortController().signal };

function seedFiles(cwd, count) {
  for (let i = 1; i <= count; i++) {
    writeFileSync(join(cwd, `f${String(i).padStart(2, '0')}.txt`), '');
  }
}

function helperCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'path-picker-cwd-'));

  writeFileSync(join(cwd, 'alpha.txt'), '');
  mkdirSync(join(cwd, 'subdir'));

  return cwd;
}

// ── Outside delimiters: transparent native delegation ───────────────

test('built-in slash commands keep native suggestions', async () => {
  for (const command of ['/model', '/settings']) {
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([command], 0, command.length, { ...SIG, force: false });

    assert.deepEqual(
      suggestions,
      { prefix: command, items: [{ value: 'model', label: 'model' }] },
      `${command} must preserve native suggestions`
    );
    assert.equal(
      calls.filter(([name]) => name === 'getSuggestions').length,
      1,
      `${command} must delegate exactly once`
    );
  }
});

test('every other outside context stays owned by the wrapped provider', async () => {
  for (const [line, force] of [
    ['@README', false],
    ['plain text', true],
    ['/reasoning ', false],
  ]) {
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force });

    assert.equal(suggestions.prefix, line);
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 1, `${line} must delegate exactly once`);
  }
});

test('native file-trigger decision is preserved outside quote pairs', async () => {
  for (const nativeResult of [true, false]) {
    const { provider, calls } = await createProvider('/tmp', nativeResult);
    const result = provider.shouldTriggerFileCompletion(['/model'], 0, 6);

    assert.equal(result, nativeResult, 'outside trigger decision must match native provider');
    assert.equal(calls.filter(([name]) => name === 'shouldTriggerFileCompletion').length, 1);
  }
});

test('path picker adds no trigger characters of its own', async () => {
  const { provider } = await createProvider();

  assert.deepEqual(provider.triggerCharacters, ['$']);
});

// ── Inside delimiters: path autocomplete, no delegation ──

test('OPEN quote pair + Tab -> path autocomplete (natural typing)', async () => {
  for (const delimiter of ['"', "'", '`']) {
    const cwd = helperCwd();
    const { provider, calls } = await createProvider(cwd);
    const line = `${delimiter}./`;
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

    assert.notEqual(suggestions, null, `TAB inside an open ${delimiter} pair must trigger the path picker`);
    assert.equal(suggestions.prefix, './');
    assert.equal(
      suggestions.items.some((item) => item.value === './alpha.txt'),
      true,
      'should find alpha.txt'
    );
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0, 'open pair must not delegate');
  }
});

test('CLOSED quote pair, cursor after the closing quote + Tab -> path autocomplete', async () => {
  for (const delimiter of ['"', "'", '`']) {
    const cwd = helperCwd();
    const { provider, calls } = await createProvider(cwd);
    const line = `${delimiter}./${delimiter}`;
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

    assert.notEqual(suggestions, null, `TAB after the closing ${delimiter} must still own the path token`);
    assert.equal(suggestions.prefix, './');
    assert.equal(
      suggestions.items.some((item) => item.value === './alpha.txt'),
      true,
      'should find alpha.txt'
    );
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0, 'closed pair must not delegate');
  }
});

test('natural typing (no Tab) inside quotes delegates to native', async () => {
  for (const path of ['/', '~/', './', '../']) {
    const { provider, calls } = await createProvider();
    const line = `"${path}`;
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: false });

    assert.equal(suggestions.prefix, line, `${path} without Tab must reach the native provider`);
    assert.equal(
      calls.filter(([name]) => name === 'getSuggestions').length,
      1,
      `${path} without Tab must delegate once`
    );
  }
});

test('Tab after a non-path quoted token closes the menu without native', async () => {
  for (const delimiter of ['"', "'", '`']) {
    const line = `${delimiter}.`;
    const { provider, calls } = await createProvider();

    assert.equal(provider.shouldTriggerFileCompletion([line], 0, line.length), true);
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

    assert.equal(suggestions, null, `${delimiter}. + Tab must not show suggestions`);
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0, 'non-path token must not delegate');
  }
});

test('Tab without a slash does not trigger path autocomplete', async () => {
  for (const delimiter of ['"', "'", '`']) {
    const { provider, calls } = await createProvider();
    const line = `${delimiter}~`;

    assert.equal(provider.shouldTriggerFileCompletion([line], 0, line.length), true);
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

    assert.equal(suggestions, null, 'Tab must require a slash in the quoted token');
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
  }
});

test('deleting the opening quote hands the context back to native', async () => {
  // `"./` + Tab owned the menu; deleting the opening quote leaves `./`
  // with no quote region -> the native provider decides again.
  const { provider, calls } = await createProvider();

  assert.equal(provider.shouldTriggerFileCompletion(['./'], 0, 2), true);
  const suggestions = await provider.getSuggestions(['./'], 0, 2, { ...SIG, force: true });

  assert.equal(suggestions.prefix, './', 'outside delegation must return the native result');
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 1);
});

test('escaped delimiters are plain text and preserve native behavior', async () => {
  for (const delimiter of ['"', "'", '`']) {
    const line = `\\${delimiter}`;
    const { provider, calls } = await createProvider();
    const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: false });

    assert.deepEqual(
      suggestions,
      { prefix: line, items: [{ value: 'model', label: 'model' }] },
      `escaped ${delimiter} must preserve native suggestions`
    );
    assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 1);
  }
});

test('apostrophe inside double quotes is plain text, not a broken pair', async () => {
  const cwd = helperCwd();

  writeFileSync(join(cwd, "it's.txt"), '');
  const { provider, calls } = await createProvider(cwd);
  const line = '"./it\'s';
  const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

  assert.notEqual(suggestions, null, 'a quoted token containing an apostrophe must still trigger');
  assert.equal(
    suggestions.items.some((item) => item.value === "./it's.txt" || item.value === "./it's.txt/"),
    true,
    'should complete the apostrophe file'
  );
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});

test('relative path without ./ never grabs a trailing / as absolute', async () => {
  const cwd = helperCwd();

  mkdirSync(join(cwd, 'src'));
  const { provider, calls } = await createProvider(cwd);
  const line = '"a/b';
  const suggestions = await provider.getSuggestions([line], 0, line.length, { ...SIG, force: true });

  assert.equal(suggestions, null, 'a/b must NOT match /b as an absolute path');
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});

test('TAB inside quotes with / -> absolute path', async () => {
  const { provider, calls } = await createProvider();
  const suggestions = await provider.getSuggestions(['"/'], 0, 2, { ...SIG, force: true });

  assert.notEqual(suggestions, null, 'TAB after "/" inside quotes must trigger path picker');
  assert.equal(suggestions.prefix, '/');
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});

test('absolute partial path builds single-slash values', async () => {
  // Regression: dirname("/et") === "/" used to produce "//etc".
  const { provider, calls } = await createProvider();
  const suggestions = await provider.getSuggestions(['"/et'], 0, 4, { ...SIG, force: true });

  assert.notEqual(suggestions, null, 'TAB after "/et" must list root entries starting with "et"');
  assert.ok(suggestions.items.length > 0, 'root must contain entries');

  for (const item of suggestions.items) {
    assert.equal(item.value.startsWith('//'), false, `value must not start with // (got ${item.value})`);
    assert.equal(item.value.startsWith('/'), true, `value must be absolute (got ${item.value})`);
  }

  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});

test('paths with spaces are captured inside the quotes', async () => {
  const cwd = helperCwd();

  mkdirSync(join(cwd, 'My Projects'));
  writeFileSync(join(cwd, 'My Projects', 'notes.md'), '');
  const { provider, calls } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./My Projects/'], 0, 15, { ...SIG, force: true });

  assert.notEqual(suggestions, null, 'a path with spaces inside quotes must trigger');
  assert.equal(
    suggestions.items.some((item) => item.value === './My Projects/notes.md'),
    true,
    'should complete inside the spaced directory'
  );
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});

// ── applyCompletion ────────────────────────────────────────────────

test('applyCompletion outside delegates to current', async () => {
  const { provider, calls } = await createProvider();
  const result = provider.applyCompletion(['/mod'], 0, 4, { value: '/model', label: 'model' }, '/mod');

  assert.deepEqual(result, { lines: ['/model '], cursorLine: 0, cursorCol: 7 });
  assert.equal(calls.filter(([name]) => name === 'applyCompletion').length, 1);
});

test('applyCompletion replaces exactly the open-pair token', async () => {
  const cwd = helperCwd();
  const { provider, calls } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./'], 0, 3, { ...SIG, force: true });
  const applied = provider.applyCompletion(
    ['"./'],
    0,
    3,
    suggestions.items.find((item) => item.value === './alpha.txt'),
    suggestions.prefix
  );

  assert.deepEqual(applied, { lines: ['"./alpha.txt'], cursorLine: 0, cursorCol: 12 });
  assert.equal(calls.filter(([name]) => name === 'applyCompletion').length, 0, 'path apply must not delegate');
});

test('applyCompletion keeps the closing quote of a closed pair', async () => {
  const cwd = helperCwd();
  const { provider, calls } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./"'], 0, 4, { ...SIG, force: true });
  const applied = provider.applyCompletion(
    ['"./"'],
    0,
    4,
    suggestions.items.find((item) => item.value === './alpha.txt'),
    suggestions.prefix
  );

  assert.deepEqual(applied, { lines: ['"./alpha.txt"'], cursorLine: 0, cursorCol: 12 });
  assert.equal(calls.filter(([name]) => name === 'applyCompletion').length, 0, 'path apply must not delegate');
});

test('applyCompletion for a partial name keeps the directory prefix', async () => {
  const cwd = helperCwd();

  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'main.ts'), '');
  const { provider, calls } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./s'], 0, 4, { ...SIG, force: true });
  const applied = provider.applyCompletion(
    ['"./s'],
    0,
    4,
    suggestions.items.find((item) => item.value === './src/'),
    suggestions.prefix
  );

  assert.deepEqual(applied, { lines: ['"./src/'], cursorLine: 0, cursorCol: 7 });
  assert.equal(calls.filter(([name]) => name === 'applyCompletion').length, 0);
});

// ── shouldTriggerFileCompletion inside quotes ──────────────────────

test('shouldTriggerFileCompletion inside a region with a path -> true, no delegation', async () => {
  const { provider, calls } = await createProvider();

  for (const line of ['"./s', '"./', '"plain']) {
    assert.equal(provider.shouldTriggerFileCompletion([line], 0, line.length), true);
  }

  assert.equal(calls.filter(([name]) => name === 'shouldTriggerFileCompletion').length, 0);
});

// ── Menu contents: complete listing on a single Tab ────────────────

test('first Tab lists EVERY file and directory (no cap)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'path-picker-cwd-'));

  seedFiles(cwd, 40);
  const { provider } = await createProvider(cwd);

  const line = '"./';
  const first = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });

  assert.equal(first.items.length, 40, 'Tab must list every file (no cap)');
  assert.equal(
    first.items.some((item) => item.value === './f40.txt'),
    true,
    'items beyond the old cap must be visible'
  );
});

test('first Tab already includes hidden files; repeated Tab is stable', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'path-picker-cwd-'));

  seedFiles(cwd, 40);
  writeFileSync(join(cwd, '.env'), '');
  mkdirSync(join(cwd, 'subdir'));
  const { provider } = await createProvider(cwd);

  const line = '"./';
  const first = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });
  const second = await provider.getSuggestions([line], 0, 3, { ...SIG, force: true });

  assert.equal(first.items.length, 42, 'first Tab must list 40 files + .env + subdir');
  assert.equal(
    first.items.some((item) => item.value === './.env'),
    true,
    'hidden files must be listed on the first Tab'
  );
  assert.equal(
    first.items.some((item) => item.value === './subdir/'),
    true,
    'directories must be listed'
  );
  assert.deepEqual(second.items, first.items, 'a repeated Tab must not change the listing (no double-tab mode)');
});

test('hidden entries are listed without any dot prefix', async () => {
  const cwd = helperCwd();

  writeFileSync(join(cwd, '.hidden.txt'), '');
  const { provider } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./'], 0, 3, { ...SIG, force: true });

  assert.equal(
    suggestions.items.some((item) => item.value === './.hidden.txt'),
    true,
    'dotfiles must be in the complete listing'
  );
});

test('names with control characters (macOS Icon\\r) are skipped', async () => {
  const cwd = helperCwd();

  writeFileSync(join(cwd, 'Icon\r'), ''); // Finder folder-icon artifact (carriage return)
  writeFileSync(join(cwd, '.DS_Store'), '');
  writeFileSync(join(cwd, 'normal.txt'), '');
  const { provider } = await createProvider(cwd);

  const complete = await provider.getSuggestions(['"./'], 0, 3, { ...SIG, force: true });

  assert.equal(
    complete.items.some((item) => item.value.includes('Icon')),
    false,
    'Icon\\r must not appear in the complete listing'
  );
  assert.equal(
    complete.items.some((item) => item.value === './normal.txt'),
    true,
    'regular files must stay'
  );
  assert.ok(
    complete.items.every((item) => !/[\u0000-\u001F\u007F]/.test(item.value)),
    'no item value may contain control characters'
  );

  const filtered = await provider.getSuggestions(['"./n'], 0, 4, { ...SIG, force: true });

  assert.equal(
    filtered.items.some((item) => item.value === './normal.txt'),
    true,
    'filtered listing must keep working'
  );
  assert.equal(
    filtered.items.some((item) => item.value.includes('Icon')),
    false,
    'Icon\\r must not slip into filtered listings either'
  );
});

test('a directory token lists complete contents; a partial name filters', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'path-picker-cwd-'));

  seedFiles(cwd, 40);
  writeFileSync(join(cwd, '.env'), '');
  mkdirSync(join(cwd, 'subdir'));
  writeFileSync(join(cwd, 'subdir', 'inner.txt'), '');
  const { provider } = await createProvider(cwd);

  // Directory token: complete listing of ./ (40 files + .env + subdir).
  const root = await provider.getSuggestions(['"./'], 0, 3, { ...SIG, force: true });

  assert.equal(root.items.length, 42, 'complete listing of ./ (40 files + .env + subdir)');
  assert.equal(
    root.items.some((item) => item.value === './.env'),
    true,
    'dotfiles belong to the complete listing'
  );

  // Partial name: only entries matching the prefix, dotfiles excluded.
  const partial = await provider.getSuggestions(['"./f'], 0, 4, { ...SIG, force: true });

  assert.equal(partial.items.length, 40, `partial "./f" must list only the 40 f* files (got ${partial.items.length})`);
  assert.equal(
    partial.items.some((item) => item.value === './f40.txt'),
    true,
    'the last f* file must still be visible (no cap)'
  );
  assert.equal(
    partial.items.some((item) => item.value === './.env' || item.value === './subdir/'),
    false,
    'non-matching dotfiles and dirs must not appear'
  );

  // Deeper partial name filters inside the folder it points at.
  const deep = await provider.getSuggestions(['"./subdir/in'], 0, 11, { ...SIG, force: true });

  assert.equal(deep.items.length, 1, 'partial inside ./subdir/ must filter to inner.txt');
  assert.equal(
    deep.items.some((item) => item.value === './subdir/inner.txt'),
    true
  );

  // Directory token inside subdir: complete listing again.
  const inner = await provider.getSuggestions(['"./subdir/'], 0, 10, { ...SIG, force: true });

  assert.equal(inner.items.length, 1, 'complete listing of ./subdir/');
  assert.equal(
    inner.items.some((item) => item.value === './subdir/inner.txt'),
    true
  );
});

test('dot-prefix partials reveal hidden entries', async () => {
  const cwd = helperCwd();

  writeFileSync(join(cwd, '.hidden.txt'), '');
  writeFileSync(join(cwd, '.other.txt'), '');
  const { provider } = await createProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./.h'], 0, 5, { ...SIG, force: true });

  assert.equal(
    suggestions.items.some((item) => item.value === './.hidden.txt'),
    true,
    'a .-prefixed query must match hidden files'
  );
  assert.equal(
    suggestions.items.some((item) => item.value === './.other.txt'),
    false,
    'dotfiles outside the prefix must stay hidden'
  );
});

test('sensitive directories are refused', async () => {
  const { provider, calls } = await createProvider();
  const suggestions = await provider.getSuggestions(['"~/.ssh/'], 0, 8, { ...SIG, force: true });

  assert.equal(suggestions, null, 'sensitive directories must not be listed');
  assert.equal(calls.filter(([name]) => name === 'getSuggestions').length, 0);
});
