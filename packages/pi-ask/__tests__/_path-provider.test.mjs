/**
 * pi-ask - path completion bridge suite
 *
 * The `ask` and `interview` UIs render their own pi-tui editor, so pi's
 * autocomplete chain never reaches them. These tests pin both halves of the
 * fix: the bridge that borrows pi-path-picker's provider over `pi.events`, and
 * the render-cache bypass that lets the menu actually paint.
 *
 * The completion rule belongs to pi-path-picker and is unchanged:
 * `./`, `~/` or `/` inside `"`, `'` or `` ` `` plus Tab.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pathPickerExtension from '../../pi-path-picker/index.ts';
import { createAskTool } from '../lib/_ask.ts';
import { createInterviewTool } from '../lib/_interview-tool.ts';
import { createMockPi, makeTheme } from '../../../test/harness.mjs';
import {
  attachPathAutocomplete,
  mustRebuildForAutocomplete,
  PATH_PICKER_PROVIDER_CHANNEL,
  resolvePathAutocompleteProvider,
} from '../lib/_path-provider.ts';

const KEY = { escape: '\x1b', enter: '\r', up: '\x1b[A', down: '\x1b[B' };

function seededCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-ask-paths-'));

  writeFileSync(join(cwd, 'alpha.txt'), '');
  mkdirSync(join(cwd, 'subdir'));

  return cwd;
}

/** A `pi` whose event bus carries a real pi-path-picker listener. */
function piWithPathPicker() {
  const { pi } = createMockPi();

  pathPickerExtension(pi);

  return pi;
}

function installDriver(ctx) {
  let component;

  ctx.ui.custom = (factory) =>
    new Promise((resolve) => {
      const tui = { terminal: { rows: 40 }, requestRender() {} };

      component = factory(tui, makeTheme(), {}, resolve);
    });

  return {
    render: () => component.render(100).join('\n'),
    key: (k) => component.handleInput(k),
    type: (text) => {
      for (const ch of text) {
        component.handleInput(ch);
      }
    },
  };
}

/** Let the editor's (async) suggestion request settle. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ── Contract plumbing ────────────────────────────────────────────────

test('channel literal matches the producer', () => {
  assert.equal(PATH_PICKER_PROVIDER_CHANNEL, 'pi-path-picker:provider');
});

test('no bus → no provider, no throw', () => {
  assert.equal(resolvePathAutocompleteProvider(undefined, '/tmp'), undefined);
});

test('bus with no listener (path-picker absent) → no provider', () => {
  assert.equal(resolvePathAutocompleteProvider({ events: { emit() {} } }, '/tmp'), undefined);
});

test('the request carries cwd and a reply callback', () => {
  const seen = [];
  const bus = {
    events: {
      emit(channel, data) {
        seen.push([channel, data]);
        data.reply({ sentinel: true });
      },
    },
  };
  const provider = resolvePathAutocompleteProvider(bus, '/some/cwd');

  assert.deepEqual(provider, { sentinel: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], PATH_PICKER_PROVIDER_CHANNEL);
  assert.equal(seen[0][1].cwd, '/some/cwd');
  assert.equal(typeof seen[0][1].reply, 'function');
});

test('a throwing bus is contained', () => {
  const bus = {
    events: {
      emit() {
        throw new Error('bus exploded');
      },
    },
  };

  assert.equal(resolvePathAutocompleteProvider(bus, '/tmp'), undefined);
});

test('attach returns false and touches nothing when no provider answers', () => {
  const calls = [];
  const editor = { setAutocompleteProvider: (p) => calls.push(p) };

  assert.equal(attachPathAutocomplete(editor, undefined, '/tmp'), false);
  assert.equal(attachPathAutocomplete(editor, { events: { emit() {} } }, '/tmp'), false);
  assert.deepEqual(calls, []);
});

test('attach returns false when the editor cannot host autocomplete', () => {
  const pi = piWithPathPicker();

  assert.equal(attachPathAutocomplete({}, pi, '/tmp'), false);
  assert.equal(attachPathAutocomplete(undefined, pi, '/tmp'), false);
});

test('attach installs the provider on a capable editor', () => {
  const pi = piWithPathPicker();
  const calls = [];
  const editor = { setAutocompleteProvider: (p) => calls.push(p) };

  assert.equal(attachPathAutocomplete(editor, pi, '/tmp'), true);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].getSuggestions, 'function');
});

// ── Render-cache bypass ──────────────────────────────────────────────

test('cache is only bypassed while the menu is open', () => {
  assert.equal(mustRebuildForAutocomplete(undefined), false);
  assert.equal(mustRebuildForAutocomplete({}), false);
  assert.equal(mustRebuildForAutocomplete({ isShowingAutocomplete: () => false }), false);
  assert.equal(mustRebuildForAutocomplete({ isShowingAutocomplete: () => true }), true);
});

// ── End to end: `ask` ────────────────────────────────────────────────

test('ask: Tab inside a quoted path renders the picker in the custom-answer field', async () => {
  const cwd = seededCwd();
  const pi = piWithPathPicker();
  const tool = createAskTool(pi);
  const ctx = { mode: 'tui', ui: {}, cwd };
  const driver = installDriver(ctx);

  const execPromise = tool.execute(
    'c1',
    {
      question: 'Where?',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    undefined,
    undefined,
    ctx
  );

  // Reach the "Type something." row → write mode, editor focused.
  driver.key(KEY.down);
  driver.key(KEY.down);
  assert.match(driver.render(), /Your answer:/, 'editor must be open');

  driver.type('`./`');
  driver.key('\t');
  await settle();

  const text = driver.render();

  assert.match(text, /alpha\.txt/, `picker must list the cwd contents, got:\n${text}`);
  assert.match(text, /subdir/, 'directories must be listed too');

  driver.key(KEY.escape);
  driver.key(KEY.escape);
  await execPromise;
});

test('ask: the rule still holds - Tab outside quotes shows nothing', async () => {
  const cwd = seededCwd();
  const pi = piWithPathPicker();
  const tool = createAskTool(pi);
  const ctx = { mode: 'tui', ui: {}, cwd };
  const driver = installDriver(ctx);

  const execPromise = tool.execute(
    'c1',
    { question: 'Where?', options: [{ value: 'a', label: 'A' }] },
    undefined,
    undefined,
    ctx
  );

  driver.key(KEY.down); // → "Type something."
  driver.type('./');
  driver.key('\t');
  await settle();

  assert.equal(driver.render().includes('alpha.txt'), false, 'unquoted paths must not open the picker');

  driver.key(KEY.escape);
  driver.key(KEY.escape);
  await execPromise;
});

test('ask: without pi-path-picker the field behaves exactly as before', async () => {
  const cwd = seededCwd();
  const tool = createAskTool(); // no bus
  const ctx = { mode: 'tui', ui: {}, cwd };
  const driver = installDriver(ctx);

  const execPromise = tool.execute(
    'c1',
    { question: 'Where?', options: [{ value: 'a', label: 'A' }] },
    undefined,
    undefined,
    ctx
  );

  driver.key(KEY.down);
  driver.type('`./`');
  driver.key('\t');
  await settle();

  const text = driver.render();

  assert.equal(text.includes('alpha.txt'), false);
  assert.match(text, /Your answer:/, 'editor must still render');

  driver.key(KEY.escape);
  driver.key(KEY.escape);
  await execPromise;
});

// ── End to end: `interview` ──────────────────────────────────────────

test('interview: Tab inside a quoted path renders the picker in the custom-answer field', async () => {
  const cwd = seededCwd();
  const pi = piWithPathPicker();
  const tool = createInterviewTool(pi);
  const ctx = { mode: 'tui', ui: {}, cwd };
  const driver = installDriver(ctx);

  const execPromise = tool.execute(
    'c1',
    {
      questions: [
        {
          id: 'q1',
          prompt: 'Where?',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
      ],
    },
    undefined,
    undefined,
    ctx
  );

  driver.key(KEY.down);
  driver.key(KEY.down);
  assert.match(driver.render(), /Your answer:/, 'editor must be open');

  driver.type('`./`');
  driver.key('\t');
  await settle();

  const text = driver.render();

  assert.match(text, /alpha\.txt/, `picker must list the cwd contents, got:\n${text}`);

  driver.key(KEY.escape);
  driver.key(KEY.escape);
  await execPromise;
});

test('interview: Tab outside quotes still switches tabs, not the picker', async () => {
  const cwd = seededCwd();
  const pi = piWithPathPicker();
  const tool = createInterviewTool(pi);
  const ctx = { mode: 'tui', ui: {}, cwd };
  const driver = installDriver(ctx);

  const execPromise = tool.execute(
    'c1',
    {
      questions: [
        { id: 'q1', prompt: 'First?', options: [{ value: 'a', label: 'A' }] },
        { id: 'q2', prompt: 'Second?', options: [{ value: 'b', label: 'B' }] },
      ],
    },
    undefined,
    undefined,
    ctx
  );

  driver.key('\t');
  await settle();
  assert.equal(driver.render().includes('alpha.txt'), false, 'Tab navigation must stay intact');

  // Escape steps back a tab, then cancels the interview.
  driver.key(KEY.escape);
  driver.key(KEY.escape);
  await execPromise;
});
