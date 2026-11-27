/**
 * pi-lyceum - model catalog
 *
 * The bundled snapshot of Lyceum's serverless chat catalog, plus the mapping
 * onto pi's provider model config. Everything here is deterministic and
 * side-effect free: the network lives in `_discovery.ts`.
 *
 * The snapshot comes from https://lyceum.technology/models.md (prices in USD
 * per million tokens, context windows in tokens, read on 2026-11-27). The
 * embedding model is deliberately absent: it answers no chat completion, so it
 * would only produce a 400 in pi's picker.
 */

import type { Api, Model, ModelCost } from '@earendil-works/pi-ai';
import {
  LYCEUM_API_ID,
  LYCEUM_BASE_URL,
  LYCEUM_COMPAT,
  LYCEUM_EGRESS_ALLOWLIST,
  LYCEUM_MAX_OUTPUT_TOKENS,
  LYCEUM_PROVIDER_ID,
  LYCEUM_THINKING_LEVEL_MAP,
  LYCEUM_UNKNOWN_CONTEXT_WINDOW,
  LYCEUM_UNKNOWN_MAX_TOKENS,
  LYCEUM_ZERO_COST,
} from './_types.ts';

/** Input modalities a Lyceum chat model accepts. */
export type LyceumModelInput = 'text' | 'image';

/** One bundled catalog entry, as the provider page and the API describe it. */
export interface LyceumModelEntry {
  /** Exact model id `POST /chat/completions` accepts. */
  id: string;
  /** Display name shown in pi's model picker. */
  name: string;
  /** Context window in tokens. */
  contextWindow: number;
  /** Output ceiling in tokens. Defaults to Lyceum's documented maximum. */
  maxTokens?: number;
  /** Modalities the model accepts. */
  input: LyceumModelInput[];
  /** Whether the model produces a reasoning trace. */
  reasoning: boolean;
  /** USD per million tokens. */
  cost: ModelCost;
}

/**
 * Cost in USD per million tokens, the unit pi-ai prices with.
 *
 * @param input - Prompt price per million tokens.
 * @param cacheRead - Cached prompt price per million tokens.
 * @param output - Completion price per million tokens.
 * @returns A pi-ai cost record; Lyceum charges nothing for a cache write.
 */
function cost(input: number, cacheRead: number, output: number): ModelCost {
  return { input, output, cacheRead, cacheWrite: 0 };
}

/**
 * The bundled chat catalog.
 *
 * `-instant` variants and the `lyceum/*` routing aliases are included: they are
 * what `GET /models` lists and what users are told to select.
 */
export const LYCEUM_MODEL_CATALOG: readonly LyceumModelEntry[] = [
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.33, 0.033, 1.3),
  },
  {
    id: 'z-ai/glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1_000_000,
    input: ['text'],
    reasoning: true,
    cost: cost(1.4, 0.26, 4.4),
  },
  {
    id: 'moonshotai/kimi-k3.1-pro',
    name: 'Kimi K3.1 Pro',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(2, 0.2, 10),
  },
  {
    id: 'z-ai/glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.2, 0.05, 0.5),
  },
  {
    id: 'moonshotai/kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 256_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(1.25, 0.31, 4.5),
  },
  {
    id: 'qwen/qwen3.8-2.4t-a95b',
    name: 'Qwen3.8 2.4T A95B',
    contextWindow: 256_000,
    input: ['text'],
    reasoning: true,
    cost: cost(2.5, 0.63, 6),
  },
  {
    id: 'minimax/minimax-m3.1-flash',
    name: 'MiniMax M3.1 Flash',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.3, 0.075, 1.2),
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen3.8 27B',
    contextWindow: 256_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.4, 0.1, 2.4),
  },
  {
    id: 'lyceum/router',
    name: 'Lyceum Router',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.3, 0.075, 1.2),
  },
  {
    id: 'lyceum/simple',
    name: 'Lyceum Simple',
    contextWindow: 256_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.4, 0.1, 2.4),
  },
  {
    id: 'lyceum/complex',
    name: 'Lyceum Complex',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: true,
    cost: cost(0.3, 0.075, 1.2),
  },
  {
    id: 'lyceum/reasoning',
    name: 'Lyceum Reasoning',
    contextWindow: 1_000_000,
    input: ['text'],
    reasoning: true,
    cost: cost(1.4, 0.26, 4.4),
  },
  {
    id: 'deepseek/deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1_000_000,
    input: ['text'],
    reasoning: true,
    cost: cost(0.25, 0.06, 0.3),
  },
  {
    id: 'qwen/qwen3.8-27b-instant',
    name: 'Qwen3.8 27B Instant',
    contextWindow: 256_000,
    input: ['text', 'image'],
    reasoning: false,
    cost: cost(0.4, 0.1, 2.4),
  },
  {
    id: 'z-ai/glm-5.3-flash-instant',
    name: 'GLM-5.3 Flash Instant',
    contextWindow: 1_000_000,
    input: ['text', 'image'],
    reasoning: false,
    cost: cost(0.2, 0.05, 0.5),
  },
  {
    id: 'z-ai/glm-5.3-instant',
    name: 'GLM-5.3 Instant',
    contextWindow: 1_000_000,
    input: ['text'],
    reasoning: false,
    cost: cost(1.4, 0.26, 4.4),
  },
];

const catalogById = new Map(LYCEUM_MODEL_CATALOG.map((entry) => [entry.id, entry]));

/**
 * True when a model id can answer a chat completion.
 *
 * `GET /models` also lists the embedding model, which is only reachable through
 * `POST /embeddings`. Lyceum names embedding models with `embedding` in the id,
 * so the rule is a name check rather than a hardcoded list that would silently
 * fall out of date.
 *
 * @param id - Model id from the live catalog.
 * @returns Whether the id belongs in pi's chat model picker.
 */
export function isChatModelId(id: string): boolean {
  const trimmed = id.trim();

  return trimmed.length > 0 && !/embedding/i.test(trimmed);
}

/**
 * Whether a URL points at the endpoint this package is allowed to reach.
 *
 * @param value - Absolute URL to check.
 * @returns Whether it is HTTPS on an allowlisted host.
 */
export function isAllowedLyceumUrl(value: string | URL): boolean {
  try {
    const url = value instanceof URL ? value : new URL(value);

    return url.protocol === 'https:' && (LYCEUM_EGRESS_ALLOWLIST as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Look up a bundled entry by exact model id.
 *
 * @param id - Model id.
 * @returns The entry, or `undefined` when the id is not bundled.
 */
export function getCatalogEntry(id: string): LyceumModelEntry | undefined {
  return catalogById.get(id);
}

/**
 * Metadata used for a live id that the bundle does not describe.
 *
 * Every field is a documented, conservative default rather than a guess about
 * the model: a smaller context window compacts earlier instead of failing, and
 * a zero price never overstates what the user paid.
 *
 * @param id - Model id from the live catalog.
 * @returns A catalog entry carrying the fallback metadata.
 */
export function unknownModelEntry(id: string): LyceumModelEntry {
  return {
    id,
    name: id,
    contextWindow: LYCEUM_UNKNOWN_CONTEXT_WINDOW,
    maxTokens: LYCEUM_UNKNOWN_MAX_TOKENS,
    input: ['text'],
    reasoning: false,
    cost: { ...LYCEUM_ZERO_COST },
  };
}

/**
 * Map one catalog entry onto pi's model config.
 *
 * @param entry - Bundled or fallback entry.
 * @returns A pi-ai chat model for the `lyceum` provider.
 */
export function toPiModel(entry: LyceumModelEntry): Model<Api> {
  return {
    id: entry.id,
    name: entry.name,
    api: LYCEUM_API_ID,
    provider: LYCEUM_PROVIDER_ID,
    baseUrl: LYCEUM_BASE_URL,
    reasoning: entry.reasoning,
    ...(entry.reasoning ? { thinkingLevelMap: { ...LYCEUM_THINKING_LEVEL_MAP } } : {}),
    input: [...entry.input],
    cost: { ...entry.cost },
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens ?? LYCEUM_MAX_OUTPUT_TOKENS,
    compat: { ...LYCEUM_COMPAT },
  };
}

/**
 * The bundled catalog as pi models, in catalog order.
 *
 * @returns One model per bundled chat model.
 */
export function bundledModels(): Model<Api>[] {
  return LYCEUM_MODEL_CATALOG.map(toPiModel);
}

/**
 * Overlay a live id list onto the bundled catalog.
 *
 * Ids the bundle knows keep its metadata (context window, prices, modalities,
 * reasoning); ids it does not know are listed with the documented fallback.
 * Non-chat ids, blanks and duplicates are dropped, and the live order is kept
 * so pi's picker follows what the endpoint reports.
 *
 * @param ids - Model ids from `GET /models`.
 * @returns One model per usable live id.
 */
export function mergeLiveCatalog(ids: readonly string[]): Model<Api>[] {
  const seen = new Set<string>();
  const models: Model<Api>[] = [];

  for (const raw of ids) {
    if (typeof raw !== 'string') {
      continue;
    }

    const id = raw.trim();

    if (!isChatModelId(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    models.push(toPiModel(getCatalogEntry(id) ?? unknownModelEntry(id)));
  }

  return models;
}
