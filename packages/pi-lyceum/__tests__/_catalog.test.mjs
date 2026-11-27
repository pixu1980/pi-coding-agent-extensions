/**
 * pi-lyceum - catalog suite
 *
 * Pins the bundled snapshot, the mapping onto pi's model config, and the
 * overlay rules the live catalog goes through.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LYCEUM_MODEL_CATALOG,
  bundledModels,
  getCatalogEntry,
  isAllowedLyceumUrl,
  isChatModelId,
  mergeLiveCatalog,
  toPiModel,
  unknownModelEntry,
} from '../lib/_catalog.ts';
import {
  LYCEUM_API_ID,
  LYCEUM_BASE_URL,
  LYCEUM_MAX_OUTPUT_TOKENS,
  LYCEUM_PROVIDER_ID,
  LYCEUM_THINKING_LEVEL_MAP,
  LYCEUM_UNKNOWN_CONTEXT_WINDOW,
  LYCEUM_UNKNOWN_MAX_TOKENS,
} from '../lib/_types.ts';

const documentedReasoningEfforts = new Set(['none', 'low', 'medium', 'high']);

describe('bundled catalog', () => {
  it('lists every chat model and no embedding model', () => {
    const ids = LYCEUM_MODEL_CATALOG.map((entry) => entry.id);

    assert.equal(ids.length, 16);
    assert.equal(new Set(ids).size, ids.length, 'model ids must be unique');
    assert.ok(
      ids.every((id) => !/embedding/i.test(id)),
      'the embedding model belongs to another endpoint'
    );
  });

  it('carries the metadata pi needs for every entry', () => {
    for (const entry of LYCEUM_MODEL_CATALOG) {
      assert.ok(entry.id.length > 0, 'every entry needs an id');
      assert.ok(entry.name.length > 0, `${entry.id} needs a display name`);
      assert.ok(entry.contextWindow > 0, `${entry.id} needs a context window`);
      assert.ok(entry.input.length > 0, `${entry.id} needs at least one input modality`);
      assert.ok(entry.input.includes('text'), `${entry.id} must accept text`);
      assert.equal(entry.cost.cacheWrite, 0, `${entry.id} is not charged for a cache write`);
      for (const field of ['input', 'output', 'cacheRead']) {
        assert.ok(Number.isFinite(entry.cost[field]), `${entry.id} needs a numeric ${field} price`);
      }
    }
  });

  it('matches the published prices and windows', () => {
    assert.deepEqual(getCatalogEntry('deepseek/deepseek-v4.1-flash')?.cost, {
      input: 0.33,
      output: 1.3,
      cacheRead: 0.033,
      cacheWrite: 0,
    });
    assert.equal(getCatalogEntry('moonshotai/kimi-k2.7-code')?.contextWindow, 256_000);
    assert.deepEqual(getCatalogEntry('z-ai/glm-5.3')?.input, ['text']);
    assert.deepEqual(getCatalogEntry('qwen/qwen3.8-27b')?.input, ['text', 'image']);
    assert.equal(getCatalogEntry('qwen/qwen3-embedding-8b'), undefined);
  });

  it('marks instant variants as non-reasoning models', () => {
    for (const entry of LYCEUM_MODEL_CATALOG) {
      assert.equal(
        entry.reasoning,
        !entry.id.endsWith('-instant'),
        `${entry.id} answers without a reasoning phase only on the -instant variants`
      );
    }
  });
});

describe('pi model mapping', () => {
  it('points every model at the lyceum provider and the openai-completions API', () => {
    const models = bundledModels();

    assert.equal(models.length, LYCEUM_MODEL_CATALOG.length);

    for (const model of models) {
      assert.equal(model.provider, LYCEUM_PROVIDER_ID);
      assert.equal(model.api, LYCEUM_API_ID);
      assert.equal(model.baseUrl, LYCEUM_BASE_URL);
      assert.equal(model.maxTokens, LYCEUM_MAX_OUTPUT_TOKENS);
      assert.equal(model.compat.supportsStore, false);
      assert.equal(model.compat.supportsDeveloperRole, false);
      assert.equal(model.compat.supportsReasoningEffort, true);
      assert.equal(model.compat.maxTokensField, 'max_tokens');
      assert.equal(model.compat.thinkingFormat, 'openai');
    }
  });

  it('gives reasoning models a thinking map that disables thinking explicitly', () => {
    for (const entry of LYCEUM_MODEL_CATALOG.filter((candidate) => candidate.reasoning)) {
      const model = toPiModel(entry);
      const mapping = model.thinkingLevelMap ?? {};

      assert.equal(mapping.off, 'none', `${entry.id} must send reasoning_effort: none when thinking is off`);

      for (const [level, effort] of Object.entries(mapping)) {
        assert.ok(
          effort === null || documentedReasoningEfforts.has(effort),
          `${entry.id} maps ${level} to ${effort}, which is outside the documented enum`
        );
      }
    }

    assert.equal(LYCEUM_THINKING_LEVEL_MAP.off, 'none');
  });

  it('leaves instant variants without a thinking map', () => {
    for (const entry of LYCEUM_MODEL_CATALOG.filter((candidate) => !candidate.reasoning)) {
      assert.equal(toPiModel(entry).thinkingLevelMap, undefined, `${entry.id} has no reasoning phase to map`);
    }
  });

  it('copies arrays and costs so a caller cannot mutate the catalog', () => {
    const entry = getCatalogEntry('z-ai/glm-5.3-flash');
    const model = toPiModel(entry);

    model.input.push('image');
    model.cost.input = 99;

    assert.deepEqual(entry.input, ['text', 'image']);
    assert.equal(entry.cost.input, 0.2);
  });
});

describe('live catalog overlay', () => {
  it('keeps bundled metadata for a known id and adds unknown ids with fallback metadata', () => {
    const models = mergeLiveCatalog([
      'z-ai/glm-5.3',
      'acme/new-model',
      'qwen/qwen3-embedding-8b',
      'z-ai/glm-5.3',
      '',
      '   ',
    ]);

    assert.deepEqual(
      models.map((model) => model.id),
      ['z-ai/glm-5.3', 'acme/new-model']
    );

    const known = models[0];
    assert.equal(known.contextWindow, 1_000_000);
    assert.deepEqual(known.cost, { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 });
    assert.equal(known.reasoning, true);

    const unknown = models[1];
    assert.equal(unknown.name, 'acme/new-model');
    assert.equal(unknown.contextWindow, LYCEUM_UNKNOWN_CONTEXT_WINDOW);
    assert.equal(unknown.maxTokens, LYCEUM_UNKNOWN_MAX_TOKENS);
    assert.deepEqual(unknown.input, ['text']);
    assert.deepEqual(unknown.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    assert.equal(unknown.reasoning, false);
    assert.equal(unknown.thinkingLevelMap, undefined);
  });

  it('describes the fallback entry the overlay uses', () => {
    assert.deepEqual(unknownModelEntry('acme/new-model'), {
      id: 'acme/new-model',
      name: 'acme/new-model',
      contextWindow: LYCEUM_UNKNOWN_CONTEXT_WINDOW,
      maxTokens: LYCEUM_UNKNOWN_MAX_TOKENS,
      input: ['text'],
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it('rejects ids that cannot answer a chat completion', () => {
    assert.equal(isChatModelId('z-ai/glm-5.3'), true);
    assert.equal(isChatModelId('qwen/qwen3-embedding-8b'), false);
    assert.equal(isChatModelId('Qwen/Qwen3-Embedding-8B'), false);
    assert.equal(isChatModelId(''), false);
    assert.equal(isChatModelId('   '), false);
  });

  it('returns an empty list for an empty live catalog', () => {
    assert.deepEqual(mergeLiveCatalog([]), []);
  });
});

describe('egress allowlist', () => {
  it('accepts only HTTPS on the Lyceum host', () => {
    assert.equal(isAllowedLyceumUrl(LYCEUM_BASE_URL), true);
    assert.equal(isAllowedLyceumUrl(`${LYCEUM_BASE_URL}/models`), true);
    assert.equal(isAllowedLyceumUrl('http://api.lyceum.technology/openai/v1/models'), false);
    assert.equal(isAllowedLyceumUrl('https://api.lyceum.technology.evil.test/models'), false);
    assert.equal(isAllowedLyceumUrl('https://evil.test/api.lyceum.technology'), false);
    assert.equal(isAllowedLyceumUrl('not a url'), false);
  });
});
