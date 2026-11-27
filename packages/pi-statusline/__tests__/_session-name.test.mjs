/**
 * pi-statusline - session name on the editor border (unit + e2e suite)
 *
 * Covers the pure line decoration and the editor component the extension
 * installs: the session name is mirrored on the right edge, opposite pi's
 * status block, disappears when the session has no name, is truncated with an
 * ellipsis, and never breaks the editor width.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { visibleWidth } from '@earendil-works/pi-tui';
import { decorateTopBorder, createSessionNameEditor } from '../lib/_session-name.ts';
import statuslineExtension from '../index.ts';
import { createMockPi, createMockCtx, makeModel } from '../../../test/harness.mjs';

// ── Helpers ───────────────────────────────────────────────────────

/** Drop SGR sequences so assertions can look at the glyphs only. */
const strip = (text) => text.replaceAll(/\x1b\[[0-9;]*m/g, '');

const dim = (text) => `\x1b[2m${text}\x1b[22m`;
const COLORS = { color: dim };
const plainBorder = (width) => dim('─'.repeat(width));

/** EditorTheme stub: the editor only needs borderColor and a selectList theme. */
const editorTheme = { borderColor: dim, selectList: {} };

/** TUI stub: the editor constructor stores the handle, and tests count repaints through it. */
function makeTui() {
  const renders = { requests: 0 };

  return {
    renders,
    tui: {
      terminal: { rows: 30, columns: 100 },
      requestRender() {
        renders.requests += 1;
      },
    },
  };
}

// ── Unit: decorateTopBorder ───────────────────────────────────────

test('decorateTopBorder: no session name leaves the border untouched', () => {
  for (const name of [undefined, '', '   ']) {
    assert.equal(decorateTopBorder(plainBorder(80), name, 80, COLORS), plainBorder(80));
  }
});

test('decorateTopBorder: mirrors the name on the right edge, keeping the width', () => {
  const line = decorateTopBorder(plainBorder(80), 'Refactor auth module', 80, COLORS);
  const glyphs = strip(line);

  assert.equal(visibleWidth(line), 80, 'line still fills the editor width');
  assert.ok(glyphs.endsWith(' Refactor auth module ──'), `mirrored block at the right edge: ${glyphs}`);
  assert.ok(glyphs.startsWith('─'), 'border glyphs are kept on the left');
  assert.ok(!glyphs.includes('Refactor auth module────'), 'ventilated on both sides');
});

test('decorateTopBorder: keeps pi status block readable when the name is long', () => {
  const status = '⠋ Thinking…';
  const borderLine = `${dim('── ')}${status}${dim(` ${'─'.repeat(80 - 4 - visibleWidth(status))}`)}`;
  const line = decorateTopBorder(borderLine, 'a really long session name that cannot fit', 80, COLORS);
  const glyphs = strip(line);

  assert.equal(visibleWidth(line), 80);
  assert.ok(glyphs.includes(`── ${status}`), 'status block survives on the left');
  assert.ok(glyphs.endsWith('… ──'), 'name is truncated with an ellipsis');
  assert.ok(!glyphs.includes('cannot fit'), 'truncated tail is gone');
});

test('decorateTopBorder: never takes more than half the border', () => {
  const line = decorateTopBorder(plainBorder(120), 'n'.repeat(200), 120, COLORS);
  const glyphs = strip(line);

  assert.equal(visibleWidth(line), 120);
  assert.ok(glyphs.endsWith('… ──'));
  assert.ok(glyphs.startsWith('─'.repeat(56)), 'left side keeps at least half of the width');
});

test('decorateTopBorder: leaves the border alone when there is no room', () => {
  for (const width of [0, 8, 16]) {
    const border = plainBorder(width);

    assert.equal(decorateTopBorder(border, 'abc', width, COLORS), border, `width ${width}`);
  }
});

test('decorateTopBorder: paints the name with the border colour', () => {
  const line = decorateTopBorder(plainBorder(60), 'harbor', 60, COLORS);

  assert.ok(line.includes(dim(' harbor ──')), 'name, its padding and the closing dashes share the border colour');
});

test('decorateTopBorder: handles wide glyphs without overflowing', () => {
  const line = decorateTopBorder(plainBorder(40), 'プロジェクトの名前', 40, COLORS);

  assert.ok(visibleWidth(line) <= 40, 'wide characters never exceed the width');
});

// ── Unit: editor component ───────────────────────────────────────

test('createSessionNameEditor: decorates only the top border', () => {
  const { tui, renders } = makeTui();
  const Editor = createSessionNameEditor({
    getSessionName: () => 'Wiring the border',
    onTui: (handle) => assert.equal(handle, tui, 'the editor hands its TUI to the caller'),
  });
  const editor = new Editor(tui, editorTheme, {});
  const glyphs = editor.render(60).map(strip);

  assert.ok(glyphs[0].endsWith(' Wiring the border ──'), `top border carries the name: ${glyphs[0]}`);
  assert.equal(glyphs[glyphs.length - 1], '─'.repeat(60), 'bottom border is untouched');
  assert.equal(renders.requests, 0, 'rendering stays pull based');
});

test('createSessionNameEditor: keeps the working status embedded in the border', () => {
  const { tui } = makeTui();
  const Editor = createSessionNameEditor({ getSessionName: () => 'Harbor' });
  const editor = new Editor(tui, editorTheme, {});

  assert.equal(editor.embedWorkingStatus, true, 'pi keeps drawing its spinner on this border');
  assert.equal(typeof editor.setWorkingStatusIndicator, 'function', 'pi can hand the indicator to this editor');

  // What pi does when streaming: one indicator, rendered into the border.
  editor.setWorkingStatusIndicator({
    renderInBorder: () => '⠋ Thinking…',
    renderSpinnerInBorder: () => '⠋',
  });

  const glyphs = strip(editor.renderTopBorder(80, 0));

  assert.ok(glyphs.includes('── ⠋ Thinking…'), `spinner survives on the left: ${glyphs}`);
  assert.ok(glyphs.endsWith(' Harbor ──'), `name mirrored on the right: ${glyphs}`);
  assert.equal(visibleWidth(glyphs), 80);

  const painted = editor.renderTopBorder(80, 0);

  assert.ok(painted.includes(dim(' Harbor ──')), 'name shares the border colour, like the spinner');
});

test('createSessionNameEditor: the name follows the editor border colour', () => {
  const { tui } = makeTui();
  const Editor = createSessionNameEditor({ getSessionName: () => 'Harbor' });
  const editor = new Editor(tui, editorTheme, {});

  editor.borderColor = (text) => `\x1b[35m${text}\x1b[39m`;

  const line = editor.renderTopBorder(80, 0);

  assert.ok(line.includes('\x1b[35m'), 'uses the border colour the host set, not one of its own');
  assert.ok(!line.includes('\x1b[2m'), 'does not fall back to the constructor theme');
});

// ── E2E: extension wiring ─────────────────────────────────────────

test('session_start: installs an editor component for the border label', async () => {
  const { pi, emit } = createMockPi();

  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-opus-4') });

  await emit('session_start', {}, ctx);

  const call = ctx.ui._uiCalls.find(([name]) => name === 'setEditorComponent');

  assert.ok(call, 'must install an editor component');
  assert.equal(typeof call[1], 'function');
});

test('editor: shows the current session name, right aligned', async () => {
  const { pi, emit, state } = createMockPi();

  statuslineExtension(pi);
  state.sessionName = 'Fix the footer';
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-opus-4') });

  await emit('session_start', {}, ctx);

  const factory = ctx.ui._uiCalls.find(([name]) => name === 'setEditorComponent')[1];
  const { tui } = makeTui();
  const editor = factory(tui, editorTheme, {});
  const lines = editor.render(80);
  const glyphs = strip(lines[0]);

  assert.equal(visibleWidth(lines[0]), 80, 'top border fills the width');
  assert.ok(glyphs.endsWith(' Fix the footer ──'), `label at the right edge: ${glyphs}`);
});

test('editor: plain border when the session has no name', async () => {
  const { pi, emit } = createMockPi();

  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-opus-4') });

  await emit('session_start', {}, ctx);

  const factory = ctx.ui._uiCalls.find(([name]) => name === 'setEditorComponent')[1];
  const { tui } = makeTui();
  const glyphs = strip(factory(tui, editorTheme, {}).render(80)[0]);

  assert.equal(glyphs, '─'.repeat(80), 'untouched border without a name');
});

test('session_info_changed: repaints the border after a rename', async () => {
  const { pi, emit, state } = createMockPi();

  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-opus-4') });

  await emit('session_start', {}, ctx);

  const factory = ctx.ui._uiCalls.find(([name]) => name === 'setEditorComponent')[1];
  const { tui, renders } = makeTui();
  const editor = factory(tui, editorTheme, {});

  state.sessionName = 'Renamed chat';
  await emit('session_info_changed', { name: 'Renamed chat' }, ctx);

  assert.equal(renders.requests, 1, 'the editor TUI is asked to repaint');
  assert.ok(strip(editor.render(80)[0]).endsWith(' Renamed chat ──'), 'the new name is rendered');
});

test('session_shutdown: a late rename does not repaint a dead TUI', async () => {
  const { pi, emit } = createMockPi();

  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel('anthropic', 'claude-opus-4') });

  await emit('session_start', {}, ctx);

  const factory = ctx.ui._uiCalls.find(([name]) => name === 'setEditorComponent')[1];
  const { tui, renders } = makeTui();

  factory(tui, editorTheme, {});
  await emit('session_shutdown', {}, ctx);
  await emit('session_info_changed', { name: 'Late rename' }, ctx);

  assert.equal(renders.requests, 0, 'no repaint after shutdown');
});
