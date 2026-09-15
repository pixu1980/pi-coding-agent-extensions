/**
 * pi-cursor - local model catalog for the Cursor SDK
 *
 * `@cursor/sdk` validates a local agent's model selection against an in-process
 * catalog. Without an override it fetches the Cloud Agent catalog
 * (`GET /v1/models`), which answers 403 `plan_required` on a Free plan and
 * therefore blocks every local run. `CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON` is the
 * SDK's documented override; this suite pins the shape we publish.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLocalModelCatalogEnv,
  buildLocalCatalogJson,
  FALLBACK_CURSOR_MODELS,
  registerCatalog,
  resetModelCatalog,
  toSdkLocalCatalog,
} from '../lib/_models.ts';
import { CURSOR_LOCAL_CATALOG_ENV } from '../lib/_types.ts';

const CATALOG = [
  { id: 'grok-4.6', displayName: 'Grok 4.6', aliases: ['grok'] },
  { id: 'default', displayName: 'Auto' },
  { id: '  ', displayName: 'Blank' },
];

describe('toSdkLocalCatalog', () => {
  it('keeps canonical ids and aliases, and drops blank entries', () => {
    assert.deepEqual(toSdkLocalCatalog(CATALOG), [{ id: 'grok-4.6', aliases: ['grok'] }, { id: 'default' }]);
  });

  it('does not carry display metadata the validator ignores', () => {
    for (const entry of toSdkLocalCatalog(CATALOG)) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        Object.keys(entry)
          .filter((key) => ['id', 'aliases'].includes(key))
          .sort()
      );
    }
  });
});

describe('buildLocalCatalogJson', () => {
  it('serializes the registered catalog', () => {
    registerCatalog(CATALOG);
    assert.equal(buildLocalCatalogJson(), JSON.stringify([{ id: 'grok-4.6', aliases: ['grok'] }, { id: 'default' }]));
  });

  it('returns undefined when there is nothing to publish', () => {
    resetModelCatalog();
    assert.equal(buildLocalCatalogJson(), undefined);
  });
});

describe('applyLocalModelCatalogEnv', () => {
  it("publishes the catalog the SDK's local validator reads", () => {
    const env = {};

    assert.equal(applyLocalModelCatalogEnv({ env, items: FALLBACK_CURSOR_MODELS }), true);
    const parsed = JSON.parse(env[CURSOR_LOCAL_CATALOG_ENV]);

    assert.ok(
      parsed.some((entry) => entry.id === 'default'),
      'Auto must be selectable'
    );
  });

  it('never overwrites a value the user set', () => {
    const env = { [CURSOR_LOCAL_CATALOG_ENV]: '[{"id":"custom"}]' };

    assert.equal(applyLocalModelCatalogEnv({ env, items: FALLBACK_CURSOR_MODELS }), false);
    assert.equal(env[CURSOR_LOCAL_CATALOG_ENV], '[{"id":"custom"}]');
  });

  it('refreshes its own previous value', () => {
    const env = {};

    applyLocalModelCatalogEnv({ env, items: [{ id: 'one', displayName: 'One' }] });
    applyLocalModelCatalogEnv({ env, items: [{ id: 'two', displayName: 'Two' }] });
    assert.deepEqual(JSON.parse(env[CURSOR_LOCAL_CATALOG_ENV]), [{ id: 'two' }]);
  });

  it('refuses to publish an empty catalog', () => {
    const env = {};

    assert.equal(applyLocalModelCatalogEnv({ env, items: [] }), false);
    assert.equal(env[CURSOR_LOCAL_CATALOG_ENV], undefined);
  });
});

describe('fallback catalog', () => {
  it('includes Auto, the only model a Free plan can run', () => {
    const auto = FALLBACK_CURSOR_MODELS.find((item) => item.id === 'default');

    assert.equal(auto?.displayName, 'Auto');
  });
});
