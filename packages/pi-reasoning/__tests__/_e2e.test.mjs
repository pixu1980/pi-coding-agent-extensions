/**
 * pi-reasoning - e2e test suite (extension factory level)
 *
 * Drives the extension factory with a mock ExtensionAPI: event handling,
 * the /reasoning command and the autocomplete provider wrapper.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import reasoningExtension from '../index.ts';
import { createMockPi, createMockCtx, makeModel } from '../../../test/harness.mjs';
import { assertCanonicalLabel, assertLevelLabel } from './_helpers.mjs';

const SIG = { signal: new AbortController().signal, force: false };

// ── E2E: extension registration ───────────────────────────────────

test('extension registers session_start, model_select, thinking_level_select, resources_discover and /reasoning', () => {
  const { pi, commands, handlers } = createMockPi();

  reasoningExtension(pi);

  for (const event of ['session_start', 'model_select', 'thinking_level_select', 'resources_discover']) {
    assert.ok(handlers.get(event)?.length, `must register ${event}`);
  }

  assert.ok(commands.has('reasoning'), 'must register /reasoning');
});

test('extension registers /effort as an alias sharing the /reasoning definition', () => {
  const { pi, commands } = createMockPi();

  reasoningExtension(pi);
  assert.ok(commands.has('effort'), 'must register /effort');
  assert.equal(
    commands.get('effort'),
    commands.get('reasoning'),
    '/effort and /reasoning must share one definition so they cannot drift apart'
  );
});

// ── E2E: session_start ────────────────────────────────────────────

test('session_start: sets status + notifies with current level', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-sonnet-4') });

  await emit('session_start', {}, ctx);
  const status = ctx.ui._uiCalls.find(([c]) => c === 'setStatus');

  assert.ok(status, 'must set status');
  assert.match(status[2], /high/);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assert.match(notify[1], /pi-reasoning loaded/);
});

test('session_start: without a model still notifies', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx({ model: undefined });

  await emit('session_start', {}, ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assert.match(notify[1], /no model/);
});

// ── E2E: model_select ─────────────────────────────────────────────

test('model_select: opus model maps to max and sets thinking level', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-opus-4-1', {
    thinkingLevelMap: { minimal: null, low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
  });
  const ctx = createMockCtx({ model });

  await emit('model_select', { model, source: 'user' }, ctx);
  assert.equal(calls.setThinkingLevel.at(-1), 'max');
});

test('model_select: gpt-4o maps to medium', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('openai', 'gpt-4o', {
    thinkingLevelMap: { low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
  });

  await emit('model_select', { model, source: 'user' }, createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.at(-1), 'medium');
});

test('model_select: unknown model falls back to guessLevel (medium)', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('acme', 'brand-new-model-9000');

  await emit('model_select', { model, source: 'user' }, createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.at(-1), 'medium');
});

test('model_select: model without reasoning sets status, never touches level', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('openai', 'gpt-4.1-nano', { reasoning: false });
  const ctx = createMockCtx({ model });

  await emit('model_select', { model, source: 'user' }, ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , text]) => c === 'setStatus' && text.startsWith('⚪')));
});

test('model_select: long model ids are truncated in the status', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('provider', 'a-very-long-model-identifier-exceeding-20-chars');
  const ctx = createMockCtx({ model });

  await emit('model_select', { model, source: 'user' }, ctx);
  const status = ctx.ui._uiCalls.find(([c]) => c === 'setStatus');

  assert.match(status[2], /\.\.\./);
  assert.ok(status[2].length < 30, 'label must be truncated');
});

test('model_select: source restore is ignored', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-opus-4-1', { thinkingLevelMap: { max: 'max' } });

  await emit('model_select', { model, source: 'restore' }, createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.length, 0);
});

test('model_select: no reachable level → status without setting', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-opus-4-1', {
    thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
  });
  const ctx = createMockCtx({ model });

  await emit('model_select', { model, source: 'user' }, ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , text]) => c === 'setStatus' && text.startsWith('🧠')));
});

test('model_select: mapped level unavailable is rounded to closest lower', async () => {
  const { pi, emit, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('openai', 'gpt-5', {
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: null }, // only off available
  });

  await emit('model_select', { model, source: 'user' }, createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.at(-1), 'off');
});

// ── E2E: thinking_level_select ────────────────────────────────────

test('thinking_level_select: shows emoji + level in status', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx();

  await emit('thinking_level_select', { level: 'xhigh', previousLevel: 'high' }, ctx);
  assert.ok(ctx.ui._uiCalls.some(([c, , text]) => c === 'setStatus' && text.includes('xhigh')));
});

// ── E2E: /reasoning command ───────────────────────────────────────

test('/reasoning: no args opens interactive menu', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4');
  const ctx = createMockCtx({ model });

  await runCommand('reasoning', '', ctx);
  const select = ctx.ui._uiCalls.find(([c]) => c === 'select');

  assert.ok(select, 'must call select');
  assert.ok(
    select[2].some((label) => label.includes('auto')),
    'menu must include auto'
  );
});

test('/reasoning: menu selection sets the chosen level', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4', {
    thinkingLevelMap: { high: 'high', xhigh: 'max', max: 'max' },
  });
  const ctx = createMockCtx({ model });

  ctx.ui.select = async (_p, _options) => '❤️  high';
  await runCommand('reasoning', '', ctx);
  assert.equal(calls.setThinkingLevel.at(-1), 'high');
});

test('/reasoning: auto re-applies mapped level', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-opus-4-1', { thinkingLevelMap: { max: 'max' } });

  await runCommand('reasoning', 'auto', createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.at(-1), 'max');
});

test('/reasoning: auto without model notifies warning', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx({ model: undefined });

  await runCommand('reasoning', 'auto', ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , t]) => c === 'notify' && t === 'warning'));
});

test('/reasoning: auto with non-reasoning model notifies info', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx({ model: makeModel('openai', 'gpt-4.1-nano', { reasoning: false }) });

  await runCommand('reasoning', 'auto', ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , t]) => c === 'notify' && t === 'info'));
});

test('/reasoning: explicit level sets thinking level', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4', { thinkingLevelMap: { high: 'high' } });

  await runCommand('reasoning', 'high', createMockCtx({ model }));
  assert.equal(calls.setThinkingLevel.at(-1), 'high');
});

test('/reasoning: explicit level unavailable → warning', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  // reasoning model whose map disables every level → no reachable level
  const ctx = createMockCtx({
    model: makeModel('acme', 'm1', {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: null },
    }),
  });

  await runCommand('reasoning', 'high', ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , t]) => c === 'notify' && t === 'warning'));
});

test('/reasoning: reset restores default map', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx();

  await runCommand('reasoning', 'reset', ctx);
  assert.ok(ctx.ui._uiCalls.some(([c, msg]) => c === 'notify' && /reset/i.test(msg)));
});

test('/reasoning: map lists active mappings', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx();

  await runCommand('reasoning', 'map', ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assert.match(notify[1], /claude-opus-4/);
  assert.match(notify[1], /mappings/);
});

test('/reasoning: invalid level notifies warning with available list', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx();

  await runCommand('reasoning', 'bogus', ctx);
  assert.equal(calls.setThinkingLevel.length, 0);
  assert.ok(ctx.ui._uiCalls.some(([c, , t]) => c === 'notify' && t === 'warning'));
});

// ── E2E: /effort alias ────────────────────────────────────────────

test('/effort: explicit level sets the thinking level exactly like /reasoning', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4', { thinkingLevelMap: { high: 'high' } });
  const ctx = createMockCtx({ model });

  await runCommand('effort', 'high', ctx);
  assert.equal(calls.setThinkingLevel.at(-1), 'high');
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assert.match(notify[1], /Reasoning level → /);
});

test('/effort: no args opens the same interactive menu as /reasoning', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4');
  const ctx = createMockCtx({ model });

  await runCommand('effort', '', ctx);
  const select = ctx.ui._uiCalls.find(([c]) => c === 'select');

  assert.ok(select, 'must call select');
  assert.ok(
    select[2].some((label) => label.includes('auto')),
    'menu must include auto'
  );
});

test('/effort: menu selection sets the chosen level', async () => {
  const { pi, runCommand, calls } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4', {
    thinkingLevelMap: { high: 'high', xhigh: 'max', max: 'max' },
  });
  const ctx = createMockCtx({ model });

  ctx.ui.select = async (_p, options) => options.find((label) => label.endsWith('max'));
  await runCommand('effort', '', ctx);
  assert.equal(calls.setThinkingLevel.at(-1), 'max');
});

test('/effort: map and reset reach the same handlers', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const mapCtx = createMockCtx();

  await runCommand('effort', 'map', mapCtx);
  assert.match(mapCtx.ui._uiCalls.find(([c]) => c === 'notify')[1], /mappings/);
  const resetCtx = createMockCtx();

  await runCommand('effort', 'reset', resetCtx);
  assert.match(resetCtx.ui._uiCalls.find(([c]) => c === 'notify')[1], /reset/i);
});

// ── E2E: canonical label spacing ──────────────────────────────────
//
// Every emoji-labeled string the extension renders must use the optical
// separator (two spaces, one for xhigh/max), whatever surface produced it.

test('spacing: session_start status and notification are canonical', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-sonnet-4') });

  await emit('session_start', {}, ctx);
  const status = ctx.ui._uiCalls.find(([c]) => c === 'setStatus');

  assertCanonicalLabel(status[2]);
  assert.equal(status[2].endsWith('high'), true);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assertCanonicalLabel(notify[1]);
});

test('spacing: thinking_level_select status is canonical for every level', async () => {
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const { pi, emit } = createMockPi();

    reasoningExtension(pi);
    const ctx = createMockCtx();

    await emit('thinking_level_select', { level, previousLevel: 'high' }, ctx);
    const status = ctx.ui._uiCalls.find(([c]) => c === 'setStatus');

    assertLevelLabel(status[2], level);
  }
});

test('spacing: model_select status is canonical', async () => {
  const { pi, emit } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-opus-4-1', { thinkingLevelMap: { max: 'max' } });
  const ctx = createMockCtx({ model });

  await emit('model_select', { model, source: 'user' }, ctx);
  assertCanonicalLabel(ctx.ui._uiCalls.find(([c]) => c === 'setStatus')[2]);
});

test('spacing: the level-change notification is canonical', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  const model = makeModel('anthropic', 'claude-sonnet-4', { thinkingLevelMap: { high: 'high' } });
  const ctx = createMockCtx({ model });

  await runCommand('reasoning', 'high', ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assert.equal(notify[1].endsWith('high'), true, notify[1]);
  assertCanonicalLabel(notify[1].slice(notify[1].indexOf('→ ') + 2));
});

test('spacing: the auto-reasoning notification is canonical', async () => {
  const { pi, runCommand } = createMockPi();

  reasoningExtension(pi);
  // Map says max, model can only reach high → exercises the rounded notice too.
  const model = makeModel('anthropic', 'claude-opus-4-1', {
    thinkingLevelMap: { off: 'low', minimal: null, low: 'low', medium: 'high', high: 'high' },
  });
  const ctx = createMockCtx({ model });

  await runCommand('reasoning', 'auto', ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === 'notify');

  assertCanonicalLabel(notify[1].slice(notify[1].indexOf('→ ') + 2));
  const roundedIndex = notify[1].indexOf('your choice was ');

  if (roundedIndex >= 0) {
    const mention = notify[1].slice(roundedIndex + 'your choice was '.length);

    assertLevelLabel(mention.slice(0, mention.indexOf(')')), 'max');
  }
});

// ── E2E: autocomplete provider wrapper ────────────────────────────

async function getProvider(pi, emit, model) {
  reasoningExtension(pi);
  const ctx = createMockCtx({ model });

  if (model) {
    await emit('model_select', { model, source: 'user' }, ctx);
  }

  await emit('resources_discover', {}, ctx);
  const factory = ctx.ui._providers[0];
  const current = {
    triggerCharacters: ['/'],
    async getSuggestions(_lines, _line, _col, _options) {
      return { prefix: 'native', items: [{ value: 'x', label: 'native' }] };
    },
    applyCompletion(lines, line, col, _item, _prefix) {
      return { lines: [...lines], cursorLine: line, cursorCol: col, delegated: true };
    },
    shouldTriggerFileCompletion() {
      return 'native';
    },
  };

  return { provider: factory(current), current, ctx };
}

const ACTIVE_MODEL = makeModel('anthropic', 'claude-sonnet-4', {
  thinkingLevelMap: { minimal: null, low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' },
});

test('autocomplete: /effort + space shows the same menu as /reasoning', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, ACTIVE_MODEL);
  const viaEffort = await provider.getSuggestions(['/effort '], 0, 8, SIG);
  const viaReasoning = await provider.getSuggestions(['/reasoning '], 0, 11, SIG);

  assert.ok(viaEffort, 'must return suggestions for /effort');
  assert.deepEqual(
    viaEffort.items.map((i) => i.value),
    viaReasoning.items.map((i) => i.value),
    '/effort must offer the same levels as /reasoning'
  );

  for (const item of viaEffort.items) {
    if (item.value === 'auto') {
      assertCanonicalLabel(item.label);
    } else {
      assertLevelLabel(item.label, item.value);
    }
  }
});

test('autocomplete: /effort prefix filters on effort, not on the word reasoning', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, ACTIVE_MODEL);
  const result = await provider.getSuggestions(['/effort hi'], 0, 10, SIG);

  assert.ok(result, 'must return suggestions for /effort hi');
  assert.ok(result.items.every((i) => i.value.startsWith('hi')));
});

test('autocomplete: shouldTriggerFileCompletion for /effort forces true', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit);

  assert.equal(provider.shouldTriggerFileCompletion(['/effort high'], 0, 12), true);
});

test('autocomplete: /reasoning + space shows menu options (no map/reset)', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, ACTIVE_MODEL);
  const result = await provider.getSuggestions(['/reasoning '], 0, 11, SIG);

  assert.ok(result, 'must return suggestions');
  const values = result.items.map((i) => i.value);

  assert.ok(values.includes('auto'), 'auto option present');
  assert.ok(values.includes('high'), 'level options present');
  assert.ok(!values.includes('map'), 'typed-only commands hidden with empty prefix');
  assert.ok(!values.includes('reset'), 'typed-only commands hidden with empty prefix');
});

test('autocomplete: typed prefix filters to matching options', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, ACTIVE_MODEL);
  const result = await provider.getSuggestions(['/reasoning hi'], 0, 13, SIG);

  assert.ok(result, 'must return suggestions for hi');
  assert.ok(result.items.every((i) => i.value.startsWith('hi')));
  assert.ok(result.items.some((i) => i.value === 'high'));
});

test('autocomplete: typed prefix reaches typed-only commands', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, ACTIVE_MODEL);
  const result = await provider.getSuggestions(['/reasoning m'], 0, 12, SIG);

  assert.ok(result, 'must return suggestions for m');
  assert.ok(result.items.some((i) => i.value === 'map'));
});

test('autocomplete: no match → null', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit);
  const result = await provider.getSuggestions(['/reasoning zzz'], 0, 14, SIG);

  assert.equal(result, null);
});

test("autocomplete: no model yet → description 'current model'", async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit, undefined);
  const result = await provider.getSuggestions(['/reasoning '], 0, 11, SIG);

  assert.ok(result);
  assert.ok(result.items.every((i) => i.description === 'current model'));
});

test('autocomplete: other lines delegate to wrapped provider', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit);
  const result = await provider.getSuggestions(['ls -la'], 0, 6, SIG);

  assert.equal(result.prefix, 'native');
  assert.equal(result.items[0].value, 'x');
});

test('autocomplete: shouldTriggerFileCompletion for /reasoning forces true', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit);

  assert.equal(provider.shouldTriggerFileCompletion(['/reasoning high'], 0, 15), true);
  assert.equal(provider.shouldTriggerFileCompletion(['ls'], 0, 2), 'native');
});

test('autocomplete: applyCompletion delegates, fallback replaces text', async () => {
  const { pi, emit } = createMockPi();
  const { provider } = await getProvider(pi, emit);
  const delegated = provider.applyCompletion(['/reasoning '], 0, 11, { value: 'auto', label: 'auto' }, ' ');

  assert.equal(delegated.delegated, true, 'must delegate to wrapped provider');

  const fallbackCurrent = {
    triggerCharacters: [],
    async getSuggestions() {
      return null;
    },
  };
  const ctx = createMockCtx();

  await emit('resources_discover', {}, ctx);
  const fallbackProvider = ctx.ui._providers[0](fallbackCurrent);
  // Fallback contract: replaces the prefix text with value + trailing space
  const replaced = fallbackProvider.applyCompletion(['/reasoning '], 0, 11, { value: 'auto', label: '⚙️  auto' }, '');

  assert.equal(replaced.lines[0], '/reasoning auto ');
  assert.equal(replaced.cursorLine, 0);
  assert.equal(replaced.cursorCol, 16);
});
