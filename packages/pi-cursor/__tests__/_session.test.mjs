/**
 * pi-cursor - session suite
 *
 * One agent per pi session, rebuilt when the model changes, always disposed.
 * The point of these tests is that no agent can be leaked and no stale model
 * can be reused silently.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  agentSessionCount,
  disposeAgentHandle,
  getAgentSession,
  isSessionReusable,
  releaseAgentSession,
  releaseAllAgentSessions,
  rememberAgentSession,
  sessionSlotId,
} from '../lib/_session.ts';

function fakeAgent(id) {
  return {
    agentId: id,
    disposed: false,
    async [Symbol.asyncDispose]() {
      this.disposed = true;
    },
    send: async () => ({ id: 'run', wait: async () => ({ status: 'finished' }), cancel: async () => {} }),
    close() {
      this.disposed = true;
    },
  };
}

beforeEach(async () => {
  await releaseAllAgentSessions();
});

describe('sessionSlotId', () => {
  it('uses a stable slot when the session id is missing or blank', () => {
    assert.equal(sessionSlotId(undefined), 'default');
    assert.equal(sessionSlotId(''), 'default');
    assert.equal(sessionSlotId('   '), 'default');
  });

  it('keeps distinct session ids distinct', () => {
    assert.equal(sessionSlotId('abc'), 'abc');
    assert.notEqual(sessionSlotId('abc'), sessionSlotId('abd'));
  });
});

describe('isSessionReusable', () => {
  it('requires the same session and the same model', () => {
    const session = { handle: fakeAgent('a'), key: { sessionId: 's', selectionId: 'grok-4.6' } };

    assert.equal(isSessionReusable(session, { sessionId: 's', selectionId: 'grok-4.6' }), true);
    assert.equal(isSessionReusable(session, { sessionId: 's', selectionId: 'composer-2' }), false);
    assert.equal(isSessionReusable(session, { sessionId: 'other', selectionId: 'grok-4.6' }), false);
    assert.equal(isSessionReusable(undefined, { sessionId: 's', selectionId: 'grok-4.6' }), false);
  });
});

describe('agent sessions', () => {
  it('returns the live agent only for a matching model', () => {
    const agent = fakeAgent('agent-1');

    rememberAgentSession({ sessionId: 's', selectionId: 'grok-4.6' }, agent);
    assert.equal(getAgentSession({ sessionId: 's', selectionId: 'grok-4.6' }), agent);
    assert.equal(getAgentSession({ sessionId: 's', selectionId: 'other' }), undefined);
  });

  it('disposes the previous agent when a session is replaced', async () => {
    const first = fakeAgent('agent-1');
    const second = fakeAgent('agent-2');

    rememberAgentSession({ sessionId: 's', selectionId: 'm1' }, first);
    rememberAgentSession({ sessionId: 's', selectionId: 'm2' }, second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(first.disposed, true);
    assert.equal(getAgentSession({ sessionId: 's', selectionId: 'm2' }), second);
  });

  it('releases a single session and leaves the others alone', async () => {
    const a = fakeAgent('a');
    const b = fakeAgent('b');

    rememberAgentSession({ sessionId: 's1', selectionId: 'm' }, a);
    rememberAgentSession({ sessionId: 's2', selectionId: 'm' }, b);
    await releaseAgentSession('s1');
    assert.equal(a.disposed, true);
    assert.equal(b.disposed, false);
    assert.equal(agentSessionCount(), 1);
  });

  it('releases everything on shutdown', async () => {
    rememberAgentSession({ sessionId: 's1', selectionId: 'm' }, fakeAgent('a'));
    rememberAgentSession({ sessionId: 's2', selectionId: 'm' }, fakeAgent('b'));
    await releaseAllAgentSessions();
    assert.equal(agentSessionCount(), 0);
  });

  it('releasing an unknown session is a no-op', async () => {
    await releaseAgentSession('never-seen');
    assert.equal(agentSessionCount(), 0);
  });
});

describe('disposeAgentHandle', () => {
  it('prefers asyncDispose over close', async () => {
    let closed = false;
    const handle = {
      agentId: 'x',
      async [Symbol.asyncDispose]() {},
      close() {
        closed = true;
      },
      send: async () => ({ id: 'r', wait: async () => ({ status: 'finished' }), cancel: async () => {} }),
    };

    await disposeAgentHandle(handle);
    assert.equal(closed, false);
  });

  it('falls back to close when asyncDispose is absent', async () => {
    let closed = false;

    await disposeAgentHandle({ agentId: 'x', close: () => (closed = true), send: async () => ({}) });
    assert.equal(closed, true);
  });

  it('swallows disposal failures', async () => {
    await disposeAgentHandle({
      agentId: 'x',
      async [Symbol.asyncDispose]() {
        throw new Error('dead transport');
      },
    });
  });
});
