/**
 * pi-cursor - extension factory suite
 *
 * Loads the real factory against a fake ExtensionAPI. With no key in the
 * environment discovery falls back to the static catalog, so this whole suite
 * runs offline.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import extension from '../lib/index.ts';
import { releaseAllAgentSessions } from '../lib/_session.ts';
import { CURSOR_LOCAL_CATALOG_ENV } from '../lib/_types.ts';

const KEY = 'crsr_live_0123456789abcdef';

function fakePi() {
  const providers = [];
  const commands = [];
  const events = [];

  return {
    providers,
    commands,
    events,
    registerProvider: (provider) => providers.push(provider),
    unregisterProvider: () => {},
    registerCommand: (name, options) => commands.push({ name, options }),
    on: (event, handler) => events.push({ event, handler }),
  };
}

async function load() {
  const pi = fakePi();

  await extension(pi);

  return pi;
}

// The suite must never read the developer's `~/.pi/agent/auth.json`: a real key
// there would make every `load()` issue a live discovery request, and a Pro
// account would replace the fallback catalog these assertions pin.
const sandboxDir = mkdtempSync(join(tmpdir(), 'pi-cursor-extension-'));
const previousAgentDir = process.env.PI_AGENT_DIR;

beforeEach(async () => {
  await releaseAllAgentSessions();
  process.env.PI_AGENT_DIR = sandboxDir;
  delete process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_BACKEND_URL;
  delete process.env.PI_CURSOR_ALLOW_BACKEND_OVERRIDE;
  delete process.env[CURSOR_LOCAL_CATALOG_ENV];
});

after(() => {
  if (previousAgentDir === undefined) {
    delete process.env.PI_AGENT_DIR;
  } else {
    process.env.PI_AGENT_DIR = previousAgentDir;
  }

  rmSync(sandboxDir, { recursive: true, force: true });
});

describe('extension factory', () => {
  it('registers exactly one provider', async () => {
    const pi = await load();

    assert.equal(pi.providers.length, 1);
    assert.equal(pi.providers[0].id, 'cursor');
    assert.equal(pi.providers[0].name, 'Cursor');
  });

  it('exposes a usable model catalog without a key', async () => {
    const pi = await load();
    const models = pi.providers[0].getModels();

    assert.ok(models.length > 0);

    for (const model of models) {
      assert.equal(model.provider, 'cursor');
      assert.equal(model.api, 'cursor-sdk');
      assert.equal(model.baseUrl, 'https://api.cursor.com');
      assert.ok(model.contextWindow > 0);
      assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }
  });

  it('provides both stream entry points', async () => {
    const pi = await load();

    assert.equal(typeof pi.providers[0].stream, 'function');
    assert.equal(typeof pi.providers[0].streamSimple, 'function');
  });

  it('registers the three operational commands', async () => {
    const pi = await load();

    assert.deepEqual(pi.commands.map((command) => command.name).sort(), [
      'cursor-egress',
      'cursor-key',
      'cursor-models',
    ]);

    for (const command of pi.commands) {
      assert.equal(typeof command.options.handler, 'function');
    }
  });

  it('subscribes to shutdown so agents cannot be leaked', async () => {
    const pi = await load();

    assert.ok(pi.events.some((entry) => entry.event === 'session_shutdown'));
  });
});

describe('provider auth', () => {
  it('drives /login for an API key', async () => {
    const pi = await load();
    const auth = pi.providers[0].auth.apiKey;

    assert.ok(auth);
    assert.equal(typeof auth.login, 'function');
    const prompted = [];
    const credential = await auth.login({
      notify: () => {},
      prompt: async (prompt) => {
        prompted.push(prompt);

        return `  ${KEY}  `;
      },
    });

    assert.deepEqual(credential, { type: 'api_key', key: KEY });
    assert.equal(prompted[0].type, 'secret');
  });

  it('refuses an empty login', async () => {
    const pi = await load();

    await assert.rejects(
      pi.providers[0].auth.apiKey.login({ notify: () => {}, prompt: async () => '   ' }),
      /No API key entered/
    );
  });

  it('hands pi the placeholder before /login so models stay visible', async () => {
    const pi = await load();
    const result = await pi.providers[0].auth.apiKey.resolve({ credential: undefined });

    assert.equal(result?.auth.apiKey, 'pi-cursor-api-key-placeholder');
    assert.match(result?.source, /no Cursor API key configured/);
  });

  it('resolves a stored credential', async () => {
    const pi = await load();
    const result = await pi.providers[0].auth.apiKey.resolve({
      credential: { type: 'api_key', key: KEY },
    });

    assert.deepEqual(result, { auth: { apiKey: KEY }, source: 'stored API key' });
  });

  it('resolves the environment variable', async () => {
    process.env.CURSOR_API_KEY = KEY;
    const pi = await load();
    const result = await pi.providers[0].auth.apiKey.resolve({ credential: undefined });

    assert.deepEqual(result, { auth: { apiKey: KEY }, source: 'CURSOR_API_KEY' });
    delete process.env.CURSOR_API_KEY;
  });

  it('refuses to resolve when the backend was redirected off-allowlist', async () => {
    process.env.CURSOR_BACKEND_URL = 'https://evil.example';
    process.env.CURSOR_API_KEY = KEY;
    const pi = await load();

    assert.equal(await pi.providers[0].auth.apiKey.resolve({ credential: { type: 'api_key', key: KEY } }), undefined);
    delete process.env.CURSOR_BACKEND_URL;
    delete process.env.CURSOR_API_KEY;
  });

  it('resolves again once the user opts into the override', async () => {
    process.env.CURSOR_BACKEND_URL = 'https://cursor.internal.example';
    process.env.PI_CURSOR_ALLOW_BACKEND_OVERRIDE = '1';
    const pi = await load();
    const result = await pi.providers[0].auth.apiKey.resolve({ credential: { type: 'api_key', key: KEY } });

    assert.equal(result?.auth.apiKey, KEY);
    delete process.env.CURSOR_BACKEND_URL;
    delete process.env.PI_CURSOR_ALLOW_BACKEND_OVERRIDE;
  });
});

describe('provider model refresh', () => {
  it('exposes fetchModels so pi can refresh the catalog', async () => {
    const pi = await load();

    assert.equal(typeof pi.providers[0].refreshModels, 'function');
  });
});

describe('local model catalog published to the Cursor SDK', () => {
  it('lets the SDK validate local agents without the Cloud model endpoint', async () => {
    await load();
    const raw = process.env[CURSOR_LOCAL_CATALOG_ENV];

    assert.ok(raw, 'the SDK reads CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON');
    const parsed = JSON.parse(raw);

    assert.ok(Array.isArray(parsed));
    assert.ok(
      parsed.some((entry) => entry.id === 'default'),
      'Auto must survive validation'
    );

    for (const entry of parsed) {
      assert.equal(typeof entry.id, 'string');
    }
  });
});
