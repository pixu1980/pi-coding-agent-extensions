/**
 * pi-path-picker - inter-extension contract suite
 *
 * The autocomplete provider only reaches pi's main prompt. pi-ask's `ask` and
 * `interview` UIs render their own editor, so they borrow the provider over the
 * `pi.events` bus instead. These tests pin the contract that makes that work,
 * and re-prove the hard rule through the borrowed provider rather than only
 * through the main-prompt one:
 *
 *   `./`, `~/` or `/` INSIDE a quote region (`"`, `'`, `` ` ``) plus TAB.
 *   Nothing else opens the menu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEventBus } from '@earendil-works/pi-coding-agent';
import pathPickerExtension from '../index.ts';
import { createMockPi } from '../../../test/harness.mjs';
import {
  answerProviderRequest,
  NULL_AUTOCOMPLETE_PROVIDER,
  PATH_PICKER_PROVIDER_CHANNEL,
  requestProviderOverBus,
} from '../lib/_contract.ts';

const SIG = { signal: new AbortController().signal };

function seededCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'path-picker-contract-'));

  writeFileSync(join(cwd, 'alpha.txt'), '');
  writeFileSync(join(cwd, 'alpine.txt'), '');
  mkdirSync(join(cwd, 'subdir'));

  return cwd;
}

/** Ask the installed extension for a provider, exactly as pi-ask does. */
function borrowedProvider(cwd) {
  const { pi } = createMockPi();

  pathPickerExtension(pi);
  const { provider, answered } = requestProviderOverBus(pi.events, cwd);

  assert.ok(answered, 'installed pi-path-picker must answer a provider request');

  return provider;
}

// ── Contract shape ───────────────────────────────────────────────────

test('channel literal is stable: pi-ask hard-codes this exact string', () => {
  assert.equal(PATH_PICKER_PROVIDER_CHANNEL, 'pi-path-picker:provider');
});

test('the request is answered synchronously, in the same tick as emit()', () => {
  const { pi } = createMockPi();

  pathPickerExtension(pi);
  let answer = null;

  pi.events.emit(PATH_PICKER_PROVIDER_CHANNEL, {
    cwd: '/tmp',
    reply: (provider) => {
      answer = provider;
    },
  });
  // No await: consumers attach the provider immediately after emit returns.
  assert.ok(answer, 'reply must have been called before emit() returned');
});

test('no listener -> reply is never called and the consumer gets nothing', () => {
  const { pi } = createMockPi();
  // Extension NOT loaded: nobody answers.
  const { provider, answered } = requestProviderOverBus(pi.events, '/tmp');

  assert.equal(answered, false);
  assert.equal(provider, undefined);
});

// ── The same contract against pi's REAL event bus ────────────────────
//
// The harness is a stand-in; this runs `createEventBus()` from
// pi-coding-agent. It is what actually proves the synchronous guarantee, and
// it will fail loudly if pi ever makes the bus asynchronous, because every
// consumer attaches the provider in the same tick as `emit`.

function realBusPi() {
  const events = createEventBus();
  const handlers = [];

  return {
    events,
    pi: { events, on: (event, handler) => handlers.push([event, handler]) },
    handlers,
  };
}

test('real bus: a provider arrives before emit() returns', () => {
  const { pi, events } = realBusPi();

  pathPickerExtension(pi);

  let provider;
  let answeredSynchronously = false;

  events.emit(PATH_PICKER_PROVIDER_CHANNEL, {
    cwd: '/tmp',
    reply: (value) => {
      provider = value;
    },
  });
  // Still no await here: this is the whole point of the contract.
  answeredSynchronously = provider !== undefined;

  assert.equal(answeredSynchronously, true, "pi's bus must answer synchronously");
  assert.equal(typeof provider.getSuggestions, 'function');
});

test('real bus: an installed picker obeys the hard rule through the borrowed provider', async () => {
  const cwd = seededCwd();
  const { pi, events } = realBusPi();

  pathPickerExtension(pi);
  const { provider, answered } = requestProviderOverBus(events, cwd);

  assert.equal(answered, true);

  assert.equal(await provider.getSuggestions(['./'], 0, 2, { ...SIG, force: true }), null, 'no quotes -> no menu');
  assert.equal(await provider.getSuggestions(['"~"'], 0, 3, { ...SIG, force: true }), null, 'no slash -> no menu');
  const inside = await provider.getSuggestions(['"./"'], 0, 4, { ...SIG, force: true });

  assert.ok(
    inside.items.some((item) => item.value === './alpha.txt'),
    'quoted ./ plus Tab -> menu'
  );
});

test('real bus: without the extension nobody answers', () => {
  const { events } = realBusPi();
  const { provider, answered } = requestProviderOverBus(events, '/tmp');

  assert.equal(answered, false);
  assert.equal(provider, undefined);
});

// ── answerProviderRequest validation ─────────────────────────────────

test('malformed payloads are ignored, never thrown', () => {
  const create = () => NULL_AUTOCOMPLETE_PROVIDER;

  for (const payload of [
    null,
    undefined,
    'string',
    42,
    [],
    {},
    { cwd: '/tmp' },
    { reply: () => {} },
    { cwd: '', reply: () => {} },
    { cwd: '   ', reply: () => {} },
    { cwd: '/tmp', reply: 'not a function' },
    { cwd: 123, reply: () => {} },
  ]) {
    assert.equal(answerProviderRequest(payload, create), false, JSON.stringify(payload));
  }
});

test('a well-formed payload receives exactly one provider', () => {
  let received;
  const ok = answerProviderRequest({ cwd: '/tmp', reply: (p) => (received = p) }, () => NULL_AUTOCOMPLETE_PROVIDER);

  assert.equal(ok, true);
  assert.equal(received, NULL_AUTOCOMPLETE_PROVIDER);
});

test('a throwing reply is contained', () => {
  const ok = answerProviderRequest(
    {
      cwd: '/tmp',
      reply: () => {
        throw new Error('bad consumer');
      },
    },
    () => NULL_AUTOCOMPLETE_PROVIDER
  );

  assert.equal(ok, false);
});

// ── The fallback delegate ────────────────────────────────────────────

test('NULL provider declines everything and never mutates the line', async () => {
  assert.deepEqual(NULL_AUTOCOMPLETE_PROVIDER.triggerCharacters, [], 'Tab-only: no natural trigger');
  assert.equal(await NULL_AUTOCOMPLETE_PROVIDER.getSuggestions(['./'], 0, 2, { ...SIG, force: true }), null);
  const lines = ['"./"'];

  assert.deepEqual(NULL_AUTOCOMPLETE_PROVIDER.applyCompletion(lines, 0, 4, { value: 'x', label: 'x' }, './'), {
    lines,
    cursorLine: 0,
    cursorCol: 4,
  });
});

// ── Hard rule, through the borrowed provider ─────────────────────────

test('borrowed provider is Tab-only inside quotes and inert everywhere else', async () => {
  const cwd = seededCwd();
  const provider = borrowedProvider(cwd);

  // No quote region at all -> delegates to the inert fallback -> no menu.
  assert.equal(await provider.getSuggestions(['./'], 0, 2, { ...SIG, force: true }), null);
  assert.equal(await provider.getSuggestions(['./al'], 0, 4, { ...SIG, force: true }), null);

  // Quote region, but the token has no slash (`~` alone is not a path trigger).
  assert.equal(await provider.getSuggestions(['"~"'], 0, 3, { ...SIG, force: true }), null);

  // Quote region without Tab (force) -> not ours.
  assert.equal(await provider.getSuggestions(['"./"'], 0, 4, { ...SIG, force: false }), null);
});

test('borrowed provider completes paths inside every delimiter, as before', async () => {
  const cwd = seededCwd();
  const provider = borrowedProvider(cwd);

  for (const [line, col, prefix] of [
    ['"./"', 4, './'],
    ["'./'", 4, './'],
    ['`./`', 4, './'],
    ['"./al"', 6, './al'],
  ]) {
    const suggestions = await provider.getSuggestions([line], 0, col, { ...SIG, force: true });

    assert.ok(suggestions, `${line} must produce suggestions`);
    assert.equal(suggestions.prefix, prefix);
    assert.ok(suggestions.items.length > 0, `${line} must list entries`);
  }
});

test('borrowed provider lists the requested cwd, not a default', async () => {
  const cwd = seededCwd();
  const provider = borrowedProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./"'], 0, 4, { ...SIG, force: true });
  const names = suggestions.items.map((item) => item.value);

  assert.ok(names.includes('./alpha.txt'), names.join(', '));
  assert.ok(names.includes('./subdir/'), names.join(', '));
});

test('completion replaces the quoted token and preserves the closing quote', async () => {
  const cwd = seededCwd();
  const provider = borrowedProvider(cwd);
  const suggestions = await provider.getSuggestions(['"./al"'], 0, 6, { ...SIG, force: true });
  const item = suggestions.items.find((entry) => entry.value === './alpha.txt');

  assert.ok(item, 'alpha.txt must be selectable');

  const applied = provider.applyCompletion(['"./al"'], 0, 6, item, './al');

  assert.equal(applied.lines[0], '"./alpha.txt"', 'closing quote must survive');
  assert.equal(applied.cursorCol, 12);
});
