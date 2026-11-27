/**
 * pi-lyceum - extension factory suite
 *
 * Runs the real factory against a fake ExtensionAPI. Discovery is stubbed at
 * the `fetch` boundary, so nothing here reaches the network.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import extension, { buildLyceumProvider } from '../lib/index.ts';
import { bundledModels } from '../lib/_catalog.ts';
import { LYCEUM_BASE_URL, LYCEUM_PROVIDER_ID, LYCEUM_PROVIDER_NAME, LYCEUM_REFRESH_COMMAND } from '../lib/_types.ts';

const KEY = 'lk_test_0123456789abcdef';
const sandbox = mkdtempSync(join(tmpdir(), 'pi-lyceum-extension-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const realFetch = globalThis.fetch;

/**
 * @returns {{
 *   pi: Record<string, unknown>,
 *   providers: unknown[],
 *   commands: { name: string, options: Record<string, unknown> }[],
 * }}
 */
function fakePi() {
  const providers = [];
  const commands = [];

  const pi = {
    registerProvider: (provider) => providers.push(provider),
    unregisterProvider: () => {},
    registerCommand: (name, options) => commands.push({ name, options }),
    on: () => {},
  };

  return { pi, providers, commands };
}

/**
 * @param {{ hasUI?: boolean, notifications?: [string, string][] }} [options]
 * @returns {Record<string, unknown>}
 */
function fakeCtx(options = {}) {
  const notifications = options.notifications ?? [];

  return {
    hasUI: options.hasUI ?? true,
    ui: {
      notify: (message, level) => notifications.push([message, level]),
    },
  };
}

/**
 * @param {string} authPath
 */
function writeAuthFile(authPath) {
  mkdirSync(join(authPath, '..'), { recursive: true });
  writeFileSync(authPath, JSON.stringify({ lyceum: { type: 'api_key', key: KEY } }), 'utf8');
}

/**
 * @param {(url: string, init: RequestInit) => void} onCall
 * @returns {() => void} restore
 */
function stubFetch(onCall) {
  globalThis.fetch = async (url, init) => {
    onCall(url, init);

    return new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.3' }, { id: 'acme/new-model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return () => {
    globalThis.fetch = realFetch;
  };
}

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = join(sandbox, 'empty');
});

after(() => {
  globalThis.fetch = realFetch;

  if (previousAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }

  rmSync(sandbox, { recursive: true, force: true });
});

describe('provider registration', () => {
  it('registers the lyceum provider with the bundled catalog', () => {
    const { pi, providers, commands } = fakePi();

    extension(pi);

    assert.equal(providers.length, 1);
    const provider = providers[0];

    assert.equal(provider.id, LYCEUM_PROVIDER_ID);
    assert.equal(provider.name, LYCEUM_PROVIDER_NAME);
    assert.equal(provider.baseUrl, LYCEUM_BASE_URL);
    assert.equal(provider.getModels().length, 16);
    assert.ok(commands.some((command) => command.name === LYCEUM_REFRESH_COMMAND));
  });

  it('registers a provider whose models all use pi own openai-completions API', () => {
    const provider = buildLyceumProvider([]);

    assert.equal(provider.getModels().length, 0);
    assert.equal(typeof provider.stream, 'function');
    assert.equal(typeof provider.streamSimple, 'function');
  });
});

describe('authentication', () => {
  it('prompts for a secret and trims what the user pastes', async () => {
    const provider = buildLyceumProvider([]);
    const prompts = [];

    const credential = await provider.auth.apiKey.login({
      signal: new AbortController().signal,
      prompt: async (prompt) => {
        prompts.push(prompt);
        return `  ${KEY}\n`;
      },
      notify: () => {},
    });

    assert.deepEqual(credential, { type: 'api_key', key: KEY });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].type, 'secret');
  });

  it('rejects an empty key at login', async () => {
    const provider = buildLyceumProvider([]);

    await assert.rejects(
      provider.auth.apiKey.login({
        signal: new AbortController().signal,
        prompt: async () => '   ',
        notify: () => {},
      }),
      /No API key entered/
    );
  });

  it('resolves the stored credential and reports nothing when there is none', async () => {
    const provider = buildLyceumProvider([]);
    const signal = new AbortController().signal;
    const ctx = { env: async () => undefined, fileExists: async () => false };

    assert.deepEqual(await provider.auth.apiKey.resolve({ ctx, signal, credential: { type: 'api_key', key: KEY } }), {
      auth: { apiKey: KEY },
      source: 'stored API key',
    });
    assert.equal(await provider.auth.apiKey.resolve({ ctx, signal, credential: { type: 'api_key' } }), undefined);
    assert.equal(await provider.auth.apiKey.resolve({ ctx, signal }), undefined);
  });
});

describe('live refresh', () => {
  /**
   * @param {unknown[]} models
   * @returns {Record<string, unknown>}
   */
  function refreshContext() {
    return {
      credential: { type: 'api_key', key: KEY },
      allowNetwork: true,
      signal: new AbortController().signal,
      publish: async (publication) => {
        publication.update?.();

        return true;
      },
    };
  }

  it('overlays the live ids on the bundled catalog', async () => {
    const restore = stubFetch(() => {});

    try {
      const provider = buildLyceumProvider(bundledModels());
      await provider.refreshModels(refreshContext());

      const ids = provider.getModels().map((model) => model.id);

      assert.equal(ids.length, 17);
      assert.equal(ids.filter((id) => id === 'z-ai/glm-5.3').length, 1, 'a live id must replace its bundled entry');
      assert.ok(ids.includes('acme/new-model'));
    } finally {
      restore();
    }
  });

  it('keeps the bundled catalog when discovery fails', async () => {
    const restore = stubFetch(() => {
      throw new Error('network down');
    });

    try {
      const provider = buildLyceumProvider(bundledModels());
      await provider.refreshModels(refreshContext());

      assert.equal(provider.getModels().length, 16);
    } finally {
      restore();
    }
  });

  it('does not request anything without a credential', async () => {
    let called = false;

    const restore = stubFetch(() => {
      called = true;
    });

    try {
      const provider = buildLyceumProvider(bundledModels());
      await provider.refreshModels({ ...refreshContext(), credential: undefined });

      assert.equal(called, false);
      assert.equal(provider.getModels().length, 16);
    } finally {
      restore();
    }
  });
});

describe('the /lyceum-models command', () => {
  it('asks for /login when no key is stored', async () => {
    const { pi, commands, providers } = fakePi();

    extension(pi);

    const notifications = [];
    const command = commands.find((candidate) => candidate.name === LYCEUM_REFRESH_COMMAND);

    await command.options.handler('', fakeCtx({ notifications }));

    assert.equal(providers.length, 1);
    assert.deepEqual(notifications, [['No Lyceum API key configured. Run /login lyceum first.', 'warning']]);
  });

  it('replaces the provider with the live catalog when a key is stored', async () => {
    const agentDir = join(sandbox, 'agent');

    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeAuthFile(join(agentDir, 'auth.json'));

    /** @type {{ url?: string, authorization?: string }} */
    const seen = {};
    const restore = stubFetch((url, init) => {
      seen.url = url;
      seen.authorization = init.headers.Authorization;
    });

    try {
      const { pi, commands, providers } = fakePi();

      extension(pi);

      const notifications = [];
      const command = commands.find((candidate) => candidate.name === LYCEUM_REFRESH_COMMAND);

      await command.options.handler('', fakeCtx({ notifications }));

      assert.equal(seen.url, `${LYCEUM_BASE_URL}/models`);
      assert.equal(seen.authorization, `Bearer ${KEY}`);
      assert.equal(providers.length, 2);
      assert.deepEqual(
        providers[1].getModels().map((model) => model.id),
        ['z-ai/glm-5.3', 'acme/new-model']
      );
      assert.deepEqual(notifications, [['Lyceum model catalog refreshed with 2 chat models.', 'info']]);
    } finally {
      restore();
    }
  });

  it('reports a failed refresh without touching the registered provider', async () => {
    const agentDir = join(sandbox, 'agent-failure');

    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeAuthFile(join(agentDir, 'auth.json'));

    const restore = stubFetch(() => {
      throw new Error('network down');
    });

    try {
      const { pi, commands, providers } = fakePi();

      extension(pi);

      const notifications = [];
      const command = commands.find((candidate) => candidate.name === LYCEUM_REFRESH_COMMAND);

      await command.options.handler('', fakeCtx({ notifications }));

      assert.equal(providers.length, 1);
      assert.deepEqual(notifications, [['Lyceum model catalog refresh failed: network down', 'error']]);
    } finally {
      restore();
    }
  });
});
