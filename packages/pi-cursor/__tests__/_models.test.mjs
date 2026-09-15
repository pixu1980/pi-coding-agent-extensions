/**
 * pi-cursor - model catalog suite
 *
 * Covers the identity expansion (`@context`, `:fast`), thinking-level mapping,
 * selection building, and the discovery fallbacks. No network: discovery is
 * driven through an injected SDK loader.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildModelIdentities,
  buildModelSelection,
  deriveThinkingLevelMap,
  discoverCursorCatalog,
  FALLBACK_CURSOR_MODELS,
  getModelMetadata,
  isOfflineMode,
  listModelMetadata,
  parseContextWindow,
  registerCatalog,
  resetModelCatalog,
  toPiModel,
} from '../lib/_models.ts';

const CATALOG = [
  {
    id: 'grok-4.6',
    displayName: 'Grok 4.6',
    parameters: [{ id: 'effort', values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] }],
    variants: [{ params: [{ id: 'effort', value: 'high' }], displayName: 'High', isDefault: true }],
  },
  {
    id: 'composer-2',
    displayName: 'Composer 2',
    parameters: [{ id: 'context', values: [{ value: '128k' }, { value: '200k' }] }],
  },
  {
    id: 'legacy',
    displayName: 'Legacy',
    parameters: [{ id: 'thinking', values: [{ value: 'false' }, { value: 'true' }] }],
  },
];

describe('parseContextWindow', () => {
  it('parses token labels', () => {
    assert.equal(parseContextWindow('200k'), 200_000);
    assert.equal(parseContextWindow('1m'), 1_000_000);
    assert.equal(parseContextWindow('128K'), 128_000);
  });

  it('returns undefined for labels it cannot vouch for', () => {
    for (const value of ['default', '', 'lots', '200']) {
      assert.equal(parseContextWindow(value), undefined, value);
    }
  });
});

describe('deriveThinkingLevelMap', () => {
  it('maps an effort parameter', () => {
    const map = deriveThinkingLevelMap(CATALOG[0]);

    assert.equal(map?.low, 'low');
    assert.equal(map?.medium, 'medium');
    assert.equal(map?.high, 'high');
  });

  it('maps a boolean thinking parameter to off/high only', () => {
    const map = deriveThinkingLevelMap(CATALOG[2]);

    assert.equal(map?.off, 'false');
    assert.equal(map?.high, 'true');
    assert.equal(map?.medium, null);
  });

  it('returns undefined when the model has no reasoning control', () => {
    assert.equal(deriveThinkingLevelMap(CATALOG[1]), undefined);
  });
});

describe('buildModelIdentities', () => {
  it('expands context variants and keeps the canonical id', () => {
    const ids = buildModelIdentities([CATALOG[1]]).map((identity) => identity.piModelId);

    assert.deepEqual(ids, ['composer-2@128k', 'composer-2@200k']);
  });

  it('expands speed only when the model exposes a fast parameter', () => {
    const ids = buildModelIdentities([
      { id: 'm', displayName: 'M', parameters: [{ id: 'fast', values: [{ value: 'true' }] }] },
    ]).map((identity) => identity.piModelId);

    assert.deepEqual(ids, ['m', 'm:fast', 'm:slow']);
  });

  it('skips entries without an id', () => {
    assert.deepEqual(buildModelIdentities([{ id: '  ', displayName: 'x' }]), []);
  });

  it('is deterministic regardless of input order', () => {
    const forward = buildModelIdentities(CATALOG).map((identity) => identity.piModelId);
    const reversed = buildModelIdentities([...CATALOG].reverse()).map((identity) => identity.piModelId);

    assert.deepEqual(forward, reversed);
  });
});

describe('registerCatalog', () => {
  it('registers every identity and returns matching metadata', () => {
    const metadata = registerCatalog(CATALOG);

    assert.equal(metadata.length, listModelMetadata().length);
    assert.ok(getModelMetadata('grok-4.6'));
    assert.ok(getModelMetadata('composer-2@200k'));
  });

  it('uses the catalog context label for the context window', () => {
    registerCatalog(CATALOG);
    assert.equal(getModelMetadata('composer-2@200k')?.contextWindow, 200_000);
  });

  it('falls back to a conservative window for an opaque context label', () => {
    registerCatalog([{ id: 'm', displayName: 'M', parameters: [{ id: 'context', values: [{ value: 'default' }] }] }]);
    assert.ok((getModelMetadata('m@default')?.contextWindow ?? 0) > 0);
  });

  it('replaces the previous catalog instead of merging', () => {
    registerCatalog(CATALOG);
    registerCatalog([{ id: 'only', displayName: 'Only' }]);
    assert.equal(getModelMetadata('grok-4.6'), undefined);
    assert.deepEqual(
      listModelMetadata().map((entry) => entry.piModelId),
      ['only']
    );
  });

  it('records which reasoning parameters exist', () => {
    registerCatalog(CATALOG);
    assert.deepEqual(getModelMetadata('grok-4.6')?.parameterIds, {
      context: false,
      reasoning: false,
      effort: true,
      thinking: false,
      fast: false,
    });
  });
});

describe('buildModelSelection', () => {
  it('carries the default variant parameters', () => {
    registerCatalog(CATALOG);
    assert.deepEqual(buildModelSelection('grok-4.6', 'high'), {
      id: 'grok-4.6',
      params: [{ id: 'effort', value: 'high' }],
    });
  });

  it('applies the requested thinking level without duplicating a parameter', () => {
    registerCatalog(CATALOG);
    const selection = buildModelSelection('grok-4.6', 'low');

    assert.deepEqual(selection.params, [{ id: 'effort', value: 'low' }]);
  });

  it('falls back to the model id for an unknown model', () => {
    registerCatalog(CATALOG);
    assert.deepEqual(buildModelSelection('nope', 'high'), { id: 'nope' });
  });

  it('keeps the context parameter when a context variant is selected', () => {
    registerCatalog(CATALOG);
    const selection = buildModelSelection('composer-2@200k', 'off');

    assert.deepEqual(selection, { id: 'composer-2', params: [{ id: 'context', value: '200k' }] });
  });

  it('sets the speed parameter when asked', () => {
    registerCatalog([{ id: 'm', displayName: 'M', parameters: [{ id: 'fast', values: [{ value: 'true' }] }] }]);
    const selection = buildModelSelection('m:fast', 'off', true);

    assert.deepEqual(selection.params, [{ id: 'fast', value: 'true' }]);
  });
});

describe('toPiModel', () => {
  it('produces a pi-ai model with the custom api tag', () => {
    registerCatalog(CATALOG);
    const model = toPiModel(getModelMetadata('grok-4.6'), {
      providerId: 'cursor',
      api: 'cursor-sdk',
      baseUrl: 'https://api.cursor.com',
    });

    assert.equal(model.id, 'grok-4.6');
    assert.equal(model.api, 'cursor-sdk');
    assert.equal(model.provider, 'cursor');
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.input, ['text', 'image']);
    assert.equal(model.baseUrl, 'https://api.cursor.com');
  });
});

describe('discoverCursorCatalog', () => {
  function tempCache() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cursor-models-'));

    return { path: join(dir, 'cache.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it('returns the static fallback without a key, with a note', async () => {
    resetModelCatalog();
    const result = await discoverCursorCatalog({ cachePath: join(tmpdir(), 'does-not-exist.json') });

    assert.equal(result.source, 'fallback');
    assert.match(result.note, /No Cursor API key/);
    assert.deepEqual(
      result.metadata.map((entry) => entry.piModelId).sort(),
      registerCatalog(FALLBACK_CURSOR_MODELS)
        .map((entry) => entry.piModelId)
        .sort()
    );
  });

  it('fetches live and writes the cache', async () => {
    const cache = tempCache();

    try {
      let called = 0;
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => ({
          Cursor: {
            models: {
              list: async () => {
                called += 1;

                return CATALOG;
              },
            },
          },
        }),
      });

      assert.equal(result.source, 'live');
      assert.equal(called, 1);

      const cached = await discoverCursorCatalog({ apiKey: 'crsr_live_test', cachePath: cache.path });

      assert.equal(cached.source, 'cache');
    } finally {
      cache.cleanup();
    }
  });

  it('falls back to the static catalog when discovery throws', async () => {
    const cache = tempCache();

    try {
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => {
          throw new Error('offline');
        },
      });

      assert.equal(result.source, 'fallback');
      assert.match(result.note, /discovery failed/);
      assert.equal(result.quiet, undefined);
    } finally {
      cache.cleanup();
    }
  });

  // The SDK reports almost every unmapped failure as `UnknownAgentError`.
  // A note carrying only `error.name` is therefore useless: the plan/code line
  // is what tells the user why the catalog is missing.

  it('names the real error, code and status when discovery fails', async () => {
    const cache = tempCache();

    try {
      const failure = Object.assign(new Error('socket hang up'), {
        name: 'UnknownAgentError',
        code: 'internal',
        status: 500,
      });
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => {
          throw failure;
        },
      });

      assert.equal(result.source, 'fallback');
      assert.match(result.note, /UnknownAgentError/);
      assert.match(result.note, /socket hang up/);
      assert.match(result.note, /code=internal/);
      assert.match(result.note, /status=500/);
      assert.equal(result.quiet, undefined, 'a real fault must still reach stderr');
    } finally {
      cache.cleanup();
    }
  });

  it('explains a plan_required failure instead of blaming the key', async () => {
    const cache = tempCache();

    try {
      const failure = Object.assign(
        new Error('[plan_required] Cloud Agent is not available for free users. Please upgrade to Pro.'),
        { name: 'UnknownAgentError', code: 'plan_required', status: 403 }
      );
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => {
          throw failure;
        },
      });

      assert.equal(result.source, 'fallback');
      assert.match(result.note, /plan_required/);
      assert.match(result.note, /paid Cursor plan/);
      assert.match(result.note, /default/);
      assert.equal(result.quiet, true, 'a Free-plan limitation is not a startup error');
    } finally {
      cache.cleanup();
    }
  });

  it('scrubs the API key out of a discovery failure note', async () => {
    const cache = tempCache();

    try {
      const key = 'crsr_live_supersecret';
      const result = await discoverCursorCatalog({
        apiKey: key,
        cachePath: cache.path,
        loadSdk: async () => {
          throw new Error(`request with ${key} rejected`);
        },
      });

      assert.equal(result.source, 'fallback');
      assert.equal(result.note.includes(key), false);
    } finally {
      cache.cleanup();
    }
  });

  it('treats an empty live catalog as a fallback', async () => {
    const cache = tempCache();

    try {
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => ({ Cursor: { models: { list: async () => [] } } }),
      });

      assert.equal(result.source, 'fallback');
      assert.match(result.note, /empty model catalog/);
    } finally {
      cache.cleanup();
    }
  });

  // ── Offline mode ──────────────────────────────────────────────
  //
  // pi sets PI_OFFLINE for `--offline`, but the Cursor SDK issues its own
  // requests and ignores it. Without this guard an offline run still sent the
  // user's API key to Cursor at startup.

  it("isOfflineMode: reads pi's flag, strictly", () => {
    for (const value of ['1', 'true', 'yes', 'TRUE', ' 1 ']) {
      assert.equal(isOfflineMode({ PI_OFFLINE: value }), true, value);
    }

    for (const value of [undefined, '', '0', 'false', 'no', 'offline', '2']) {
      assert.equal(isOfflineMode({ PI_OFFLINE: value }), false, String(value));
    }
  });

  it('offline makes no request and says so', async () => {
    const cache = tempCache();

    try {
      let called = 0;
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        offline: true,
        cachePath: cache.path,
        loadSdk: async () => {
          called += 1;

          return { Cursor: { models: { list: async () => CATALOG } } };
        },
      });

      assert.equal(called, 0, 'the SDK must never be loaded offline');
      assert.equal(result.source, 'fallback');
      assert.match(result.note, /Offline mode/);
    } finally {
      cache.cleanup();
    }
  });

  it('offline still serves a warm cache without a request', async () => {
    const cache = tempCache();

    try {
      await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        loadSdk: async () => ({ Cursor: { models: { list: async () => CATALOG } } }),
      });

      let called = 0;
      const offline = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        offline: true,
        cachePath: cache.path,
        loadSdk: async () => {
          called += 1;

          return { Cursor: { models: { list: async () => CATALOG } } };
        },
      });

      assert.equal(called, 0);
      assert.equal(offline.source, 'cache');
    } finally {
      cache.cleanup();
    }
  });

  it('the env flag alone is enough to stay offline', async () => {
    const cache = tempCache();

    try {
      let called = 0;
      const result = await discoverCursorCatalog({
        apiKey: 'crsr_live_test',
        env: { PI_OFFLINE: '1' },
        cachePath: cache.path,
        loadSdk: async () => {
          called += 1;

          return { Cursor: { models: { list: async () => CATALOG } } };
        },
      });

      assert.equal(called, 0);
      assert.equal(result.source, 'fallback');
      assert.match(result.note, /Offline mode/);
    } finally {
      cache.cleanup();
    }
  });

  it('concurrent discoveries share one SDK list call (PERF-09 single-flight)', async () => {
    const cache = tempCache();

    try {
      let calls = 0;
      let release = () => {};

      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const loadSdk = async () => {
        calls += 1;
        await gate;

        return { Cursor: { models: { list: async () => CATALOG } } };
      };

      const options = {
        apiKey: 'crsr_live_test',
        cachePath: cache.path,
        forceRefresh: true,
        offline: false,
        loadSdk,
        now: 1000,
        ttlMs: 60_000,
      };
      const pending = [discoverCursorCatalog(options), discoverCursorCatalog(options)];

      release();
      const [first, second] = await Promise.all(pending);

      assert.equal(calls, 1, 'concurrent discoveries must share one SDK list call');
      assert.equal(first.source, 'live');
      assert.equal(second.source, 'live');
      assert.deepEqual(
        second.metadata.map((entry) => entry.piModelId).sort(),
        first.metadata.map((entry) => entry.piModelId).sort()
      );
    } finally {
      cache.cleanup();
    }
  });
});
