/**
 * pi-remote - Phase 2 tests (chat, sync, cancel, ask bridge)
 *
 * Run via the index.test.mjs barrel: node --import tsx --test __tests__/index.test.mjs
 *
 * Drives the extension through a fake relay socket: PWA peers pair over the
 * wire, then chat. SDK turn events are fired through the mock pi event bus.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import piRemoteExtension from '../index.ts';
import { createMockPi, createMockCtx } from '../../../test/harness.mjs';

// ── Helpers ──────────────────────────────────────────────────────────

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'pi-remote-'));
}

const tick = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r));
};

class FakeSocket {
  constructor(url, opts = {}) {
    this.url = url;
    this.sent = [];
    this.helloReply = opts.helloReply ?? null;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.closed = false;
    queueMicrotask(() => {
      if (!this.closed) this.onopen?.();
    });
  }

  send(data) {
    this.sent.push(data);
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      const reply = this.helloReply ?? { type: 'challenge', nonce: randomBytes(32).toString('base64') };
      queueMicrotask(() => {
        if (!this.closed) this.onmessage?.(JSON.stringify(reply));
      });
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }

  receive(line) {
    this.onmessage?.(line);
  }
}

function pwaPeerId() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(spki.subarray(spki.length - 32)).toString('base64');
}

function outerTo(peerId, inner) {
  return JSON.stringify({ peer: peerId, ct: Buffer.from(JSON.stringify(inner)).toString('base64') });
}

/** Decoded inner messages sent TO a peer (skips WS handshake frames). */
function innersTo(sock, peerId) {
  return sock.sent
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((msg) => msg && msg.peer === peerId && typeof msg.ct === 'string')
    .map((msg) => JSON.parse(Buffer.from(msg.ct, 'base64').toString('utf8')));
}

function lastUserMessage(calls) {
  return calls.sendUserMessage.at(-1);
}

/** Boots the extension and pairs one phone over the fake relay. */
async function startWithPhone(home, deviceName = 'Test Phone') {
  const harness = createMockPi();
  const { pi, runCommand, calls } = harness;
  let sock = null;
  const api = piRemoteExtension(pi, {
    homeDir: home,
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });

  await runCommand('pi-remote', 'start', ctx);
  assert.equal(api.getState(), 'started');

  const peerId = await pairPhone(runCommand, calls, ctx, sock, deviceName);
  return { ...harness, api, sock, ctx, peerId, home };
}

async function pairPhone(runCommand, calls, ctx, sock, deviceName) {
  await runCommand('pi-remote', 'pair', ctx);
  const message = lastUserMessage(calls)[0];
  const token = /Manual token fallback.*: (\S+)/.exec(message)?.[1];
  assert.ok(token, 'pair message carries a token');
  // Pairing URL carries the Pi pubkey so the PWA knows where to send.
  assert.ok(message.includes('epk='), 'pair URL carries epk');

  const peerId = pwaPeerId();
  sock.receive(
    outerTo(peerId, { type: 'pair_request', id: `req-${peerId.slice(0, 4)}`, token, device_name: deviceName })
  );
  await tick();
  const replies = innersTo(sock, peerId);
  assert.equal(replies.at(-1)?.type, 'pair_ok');
  return peerId;
}

// ── Prompt + echo ────────────────────────────────────────────────────

test('user_message wakes the agent (steer) and echoes to all peers', async () => {
  const home = makeHome();
  const { api, runCommand, calls, sock, ctx, peerId } = await startWithPhone(home);
  try {
    const peer2 = await pairPhone(runCommand, calls, ctx, sock, 'Second Phone');

    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-1', text: 'hello agent' }));
    await tick();

    const wake = calls.sendUserMessage.find(([content]) => content === 'hello agent');
    assert.ok(wake, 'agent woken with the message text');
    assert.deepEqual(wake[1], { deliverAs: 'steer' });

    for (const peer of [peerId, peer2]) {
      const echo = innersTo(sock, peer).find((m) => m.type === 'user_message' && m.id === 'm-1');
      assert.ok(echo, `echo delivered to ${peer.slice(0, 8)}`);
      assert.equal(echo.text, 'hello agent');
    }
    assert.equal(api.getChat().getCurrentTurnId(), 'm-1');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('empty text and images are rejected with errors', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startWithPhone(home);
  try {
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-empty', text: '   ' }));
    sock.receive(
      outerTo(peerId, {
        type: 'user_message',
        id: 'm-img',
        text: 'see this',
        images: [{ data: 'x', mime: 'image/png' }],
      })
    );
    await tick();

    const replies = innersTo(sock, peerId);
    assert.equal(replies.find((m) => m.in_reply_to === 'm-empty')?.code, 'invalid_message');
    assert.equal(replies.find((m) => m.in_reply_to === 'm-img')?.code, 'unsupported_type');
    assert.equal(api.getChat().getCurrentTurnId(), null);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('sendUserMessage throw surfaces as error and frees the turn', async () => {
  const harness = createMockPi();
  const origSend = harness.pi.sendUserMessage.bind(harness.pi);
  harness.pi.sendUserMessage = (content, opts) => {
    if (content === 'hi') throw new Error('busy');
    return origSend(content, opts);
  };
  const home = makeHome();
  let sock = null;
  const api = piRemoteExtension(harness.pi, {
    homeDir: home,
    socketFactory: (url) => (sock = new FakeSocket(url)),
  });
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    await harness.runCommand('pi-remote', 'start', ctx);
    const peerId = await pairPhone(harness.runCommand, harness.calls, ctx, sock, 'Phone');
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-9', text: 'hi' }));
    await tick();
    const replies = innersTo(sock, peerId);
    const err = replies.find((m) => m.in_reply_to === 'm-9');
    assert.equal(err?.type, 'error');
    assert.match(err.message, /busy/);
    assert.equal(api.getChat().getCurrentTurnId(), null);
  } finally {
    api.getRelay()?.dispose();
  }
});

// ── Streaming mirror ─────────────────────────────────────────────────

test('chunks, tools and done stream to peers; turn id clears at agent_end', async () => {
  const home = makeHome();
  const { api, emit, sock, peerId } = await startWithPhone(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-2', text: 'work' }));
    await tick();

    await emit('message_update', { assistantMessageEvent: { type: 'text_delta', delta: 'Hel' } }, ctx);
    await emit('message_update', { assistantMessageEvent: { type: 'text_delta', delta: 'lo' } }, ctx);
    await emit('tool_execution_start', { toolCallId: 'tc-1', toolName: 'Bash', args: { cmd: 'ls' } }, ctx);
    await emit(
      'tool_execution_end',
      { toolCallId: 'tc-1', result: { content: [{ type: 'text', text: 'file.txt' }] } },
      ctx
    );
    await emit('tool_execution_end', { toolCallId: 'tc-2', result: 'boom', isError: true }, ctx);
    await emit('agent_end', {}, ctx);

    const got = innersTo(sock, peerId);
    const chunks = got.filter((m) => m.type === 'agent_chunk');
    assert.deepEqual(
      chunks.map((c) => c.delta),
      ['Hel', 'lo']
    );
    assert.ok(chunks.every((c) => c.in_reply_to === 'm-2'));

    const req = got.find((m) => m.type === 'tool_request');
    assert.equal(req?.tool, 'Bash');
    assert.deepEqual(req?.args, { cmd: 'ls' });
    assert.equal(got.find((m) => m.type === 'tool_result' && m.tool_call_id === 'tc-1')?.result, 'file.txt');
    assert.equal(got.find((m) => m.type === 'tool_result' && m.tool_call_id === 'tc-2')?.error, 'boom');
    assert.equal(got.find((m) => m.type === 'agent_done')?.in_reply_to, 'm-2');
    assert.equal(api.getChat().getCurrentTurnId(), null);

    // Late agent_end emits nothing (no dangling turn).
    const before = innersTo(sock, peerId).length;
    await emit('agent_end', {}, ctx);
    assert.equal(innersTo(sock, peerId).length, before);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('local terminal input mirrors to peers; extension input is skipped', async () => {
  const home = makeHome();
  const { api, emit, sock, peerId } = await startWithPhone(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    await emit('input', { text: 'ls -la', source: 'interactive' }, ctx);
    const mirrored = innersTo(sock, peerId).find((m) => m.type === 'user_input');
    assert.ok(mirrored);
    assert.equal(mirrored.text, 'ls -la');
    assert.match(mirrored.id, /^local_/);

    const before = innersTo(sock, peerId).length;
    await emit('input', { text: 'own echo', source: 'extension' }, ctx);
    assert.equal(innersTo(sock, peerId).length, before);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('provider failure surfaces as an error frame tied to the turn', async () => {
  const home = makeHome();
  const { api, emit, sock, peerId } = await startWithPhone(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-3', text: 'go' }));
    await tick();
    await emit(
      'message_end',
      { message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'finish_reason: error' } },
      ctx
    );
    const err = innersTo(sock, peerId).find((m) => m.type === 'error' && m.code === 'provider_error');
    assert.ok(err);
    assert.equal(err.in_reply_to, 'm-3');
  } finally {
    api.getRelay()?.dispose();
  }
});

// ── History + sync ───────────────────────────────────────────────────

test('session_sync replays mapped history with limit/truncated', async () => {
  const home = makeHome();
  const { api, emit, sock, peerId } = await startWithPhone(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    await emit('message_end', { message: { role: 'user', content: 'hello agent', timestamp: 1000 } }, ctx);
    await emit(
      'message_end',
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hi!' },
            { type: 'toolCall', id: 'tc1', name: 'Bash', arguments: { cmd: 'ls' } },
          ],
          usage: { input: 10, output: 5 },
          timestamp: 1001,
        },
      },
      ctx
    );
    await emit(
      'message_end',
      { message: { role: 'toolResult', toolCallId: 'tc1', content: 'file.txt', timestamp: 1002 } },
      ctx
    );

    sock.receive(outerTo(peerId, { type: 'session_sync', id: 's-1' }));
    await tick();
    const full = innersTo(sock, peerId).find((m) => m.type === 'session_history' && m.in_reply_to === 's-1');
    assert.ok(full);
    assert.equal(full.truncated, false);
    assert.equal(full.eos, true);
    assert.equal(typeof full.session_started_at, 'number');
    assert.deepEqual(
      full.events.map((e) => e.type),
      ['user_input', 'agent_message', 'tool_request', 'tool_result']
    );
    assert.equal(full.events[0].text, 'hello agent');
    assert.equal(full.events[1].in_reply_to, full.events[0].id);
    assert.deepEqual(full.events[1].usage, { input_tokens: 10, output_tokens: 5 });

    sock.receive(outerTo(peerId, { type: 'session_sync', id: 's-2', limit: 2 }));
    await tick();
    const partial = innersTo(sock, peerId).find((m) => m.type === 'session_history' && m.in_reply_to === 's-2');
    assert.equal(partial.events.length, 2);
    assert.equal(partial.truncated, true);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('session_compact records and broadcasts a compaction marker', async () => {
  const home = makeHome();
  const { api, emit, sock, peerId } = await startWithPhone(home);
  const ctx = createMockCtx({ cwd: join(home, 'proj') });
  try {
    await emit('session_compact', { compactionEntry: { summary: 'did stuff', tokensBefore: 9000 } }, ctx);
    const live = innersTo(sock, peerId).find((m) => m.type === 'compaction');
    assert.equal(live?.summary, 'did stuff');

    sock.receive(outerTo(peerId, { type: 'session_sync', id: 's-9' }));
    await tick();
    const history = innersTo(sock, peerId).find((m) => m.type === 'session_history' && m.in_reply_to === 's-9');
    assert.equal(history.events.at(-1)?.type, 'compaction');
  } finally {
    api.getRelay()?.dispose();
  }
});

// ── ping / cancel ────────────────────────────────────────────────────

test('ping answers pong', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startWithPhone(home);
  try {
    sock.receive(outerTo(peerId, { type: 'ping', id: 'p-1' }));
    await tick();
    assert.deepEqual(
      innersTo(sock, peerId).find((m) => m.type === 'pong'),
      { type: 'pong', in_reply_to: 'p-1' }
    );
  } finally {
    api.getRelay()?.dispose();
  }
});

test('cancel aborts the turn via the freshest command ctx', async () => {
  const home = makeHome();
  const { api, runCommand, sock, peerId } = await startWithPhone(home);
  let aborted = false;
  const abortCtx = createMockCtx({
    cwd: join(home, 'proj'),
    abort: () => {
      aborted = true;
    },
  });
  try {
    await runCommand('pi-remote', 'status', abortCtx);
    sock.receive(outerTo(peerId, { type: 'user_message', id: 'm-4', text: 'long task' }));
    await tick();
    sock.receive(outerTo(peerId, { type: 'cancel', id: 'c-1', target_id: 'm-4' }));
    await tick();
    assert.ok(aborted, 'abort called on the command ctx');
    assert.deepEqual(
      innersTo(sock, peerId).find((m) => m.type === 'cancelled'),
      { type: 'cancelled', in_reply_to: 'c-1', target_id: 'm-4' }
    );
  } finally {
    api.getRelay()?.dispose();
  }
});

test('cancel with no turn reports an error', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startWithPhone(home);
  try {
    sock.receive(outerTo(peerId, { type: 'cancel', id: 'c-2', target_id: 'zzz' }));
    await tick();
    const err = innersTo(sock, peerId).find((m) => m.in_reply_to === 'c-2');
    assert.equal(err?.type, 'error');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('unknown message types get an unsupported_type error', async () => {
  const home = makeHome();
  const { api, sock, peerId } = await startWithPhone(home);
  try {
    sock.receive(outerTo(peerId, { type: 'teleport', id: 'x-1' }));
    await tick();
    const err = innersTo(sock, peerId).find((m) => m.in_reply_to === 'x-1');
    assert.equal(err?.code, 'unsupported_type');
  } finally {
    api.getRelay()?.dispose();
  }
});

// ── Ask bridge ───────────────────────────────────────────────────────

const ASK_STARTED = {
  version: 1,
  flowId: 'flow-1',
  toolCallId: 'tc-9',
  source: 'tool',
  title: 'Pick one',
  questions: [
    {
      id: 'q1',
      label: 'Q',
      prompt: 'Choose wisely',
      type: 'single',
      required: true,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
  ],
};

test('pi-ask flow broadcasts a select request with the ask envelope', async () => {
  const home = makeHome();
  const { api, pi, sock, peerId } = await startWithPhone(home);
  try {
    pi.events.emit('@eko24ive/pi-ask:started', ASK_STARTED);
    await tick();
    const req = innersTo(sock, peerId).find((m) => m.type === 'extension_ui_request');
    assert.equal(req?.id, 'flow-1');
    assert.equal(req?.method, 'select');
    assert.deepEqual(req?.options, ['A', 'B']);
    assert.equal(req?.ask?.flow_id, 'flow-1');
    assert.equal(req?.ask?.questions?.length, 1);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('degraded label answer maps back to the option value', async () => {
  const home = makeHome();
  const { api, pi, sock, peerId } = await startWithPhone(home);
  const submits = [];
  pi.events.on('@eko24ive/pi-ask:submit', (ev) => submits.push(ev));
  try {
    pi.events.emit('@eko24ive/pi-ask:started', ASK_STARTED);
    await tick();
    sock.receive(outerTo(peerId, { type: 'extension_ui_response', id: 'flow-1', value: 'B' }));
    await tick();
    assert.equal(submits.length, 1);
    assert.equal(submits[0].flowId, 'flow-1');
    assert.deepEqual(submits[0].response.answers, { q1: { values: ['b'] } });
  } finally {
    api.getRelay()?.dispose();
  }
});

test('rich structured answer and cancel forward verbatim', async () => {
  const home = makeHome();
  const { api, pi, sock, peerId } = await startWithPhone(home);
  const submits = [];
  pi.events.on('@eko24ive/pi-ask:submit', (ev) => submits.push(ev));
  try {
    pi.events.emit('@eko24ive/pi-ask:started', ASK_STARTED);
    await tick();
    const answers = { q1: { values: ['a'], note: 'go fast' } };
    sock.receive(
      outerTo(peerId, {
        type: 'extension_ui_response',
        id: 'flow-1',
        ask: { flow_id: 'flow-1', kind: 'answer', answers },
      })
    );
    await tick();
    assert.deepEqual(submits[0].response, { kind: 'answer', answers });

    sock.receive(outerTo(peerId, { type: 'extension_ui_response', id: 'flow-1', cancelled: true }));
    await tick();
    assert.equal(submits[1].response.kind, 'cancel');
  } finally {
    api.getRelay()?.dispose();
  }
});

test('completed dismisses the modal; failed submit warns', async () => {
  const home = makeHome();
  const { api, pi, sock, peerId } = await startWithPhone(home);
  try {
    pi.events.emit('@eko24ive/pi-ask:started', ASK_STARTED);
    await tick();
    pi.events.emit('@eko24ive/pi-ask:submit-result', {
      version: 1,
      requestId: 'r-1',
      flowId: 'flow-1',
      ok: false,
      error: 'bad pick',
    });
    await tick();
    const warn = innersTo(sock, peerId).find((m) => m.method === 'notify' && m.notify_type === 'warning');
    assert.equal(warn?.message, 'bad pick');

    pi.events.emit('@eko24ive/pi-ask:completed', { version: 1, flowId: 'flow-1' });
    await tick();
    const dismiss = innersTo(sock, peerId).find(
      (m) => m.method === 'notify' && !m.notify_type && m.message === 'Clarification resolved.'
    );
    assert.ok(dismiss);
  } finally {
    api.getRelay()?.dispose();
  }
});

test('session_sync replays open flows only to the syncing peer', async () => {
  const home = makeHome();
  const { api, pi, runCommand, calls, sock, ctx, peerId } = await startWithPhone(home);
  const modalsFor = (peer) => innersTo(sock, peer).filter((m) => m.type === 'extension_ui_request');
  try {
    pi.events.emit('@eko24ive/pi-ask:started', ASK_STARTED);
    await tick();
    assert.equal(modalsFor(peerId).length, 1);

    // A phone pairing AFTER the flow opened never saw the live broadcast...
    const peer2 = await pairPhone(runCommand, calls, ctx, sock, 'Late Phone');
    assert.equal(modalsFor(peer2).length, 0);

    // ...but gets the modal on sync, without re-popping it on peer1.
    sock.receive(outerTo(peer2, { type: 'session_sync', id: 's-late' }));
    await tick();
    assert.equal(modalsFor(peer2).length, 1);
    assert.equal(modalsFor(peerId).length, 1);
    assert.equal(modalsFor(peer2)[0].id, 'flow-1');
  } finally {
    api.getRelay()?.dispose();
  }
});
