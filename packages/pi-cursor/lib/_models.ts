/**
 * pi-cursor - model catalog
 *
 * Pure mapping from the Cursor model catalog (as returned by the SDK's
 * `Cursor.models.list()`, or from the local cache) onto pi's provider model
 * config. All of it is deterministic and side-effect free except for
 * `discoverCursorCatalog`, which is the single place that may hit the network.
 *
 * Model identity follows upstream's scheme so muscle memory carries over:
 *
 *   <model>                       default context, provider default speed
 *   <model>@<context>             e.g. `grok-4.6@200k`
 *   <model>:fast | <model>:slow   explicit speed override
 *   <model>@<context>:fast        both
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { CachedModelRecord } from "./_cache.ts";
import { loadCachedCatalog, saveCachedCatalog, getModelCachePath, getModelCacheTtlMs } from "./_cache.ts";
import { scrubError } from "./_scrub.ts";
import {
  CURSOR_FALLBACK_CONTEXT_WINDOW,
  CURSOR_FALLBACK_MAX_TOKENS,
  CURSOR_LOCAL_CATALOG_ENV,
  CURSOR_MODEL_INPUT,
  CURSOR_OFFLINE_ENV,
  CURSOR_ZERO_COST,
} from "./_types.ts";

// ── Structural SDK subset ─────────────────────────────────────────────────

export interface CursorModelParameterValue {
  value: string;
  displayName?: string;
}

export interface CursorModelParameterDefinition {
  id: string;
  displayName?: string;
  values: CursorModelParameterValue[];
}

export interface CursorModelVariant {
  params: { id: string; value: string }[];
  displayName: string;
  description?: string;
  isDefault?: boolean;
}

export interface CursorModelItem {
  id: string;
  displayName: string;
  description?: string;
  aliases?: string[];
  parameters?: CursorModelParameterDefinition[];
  variants?: CursorModelVariant[];
}

export type ThinkingLevelMap = Partial<
  Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>
>;

export interface CursorModelMetadata {
  piModelId: string;
  selectionModelId: string;
  baseModelId: string;
  displayName: string;
  defaultParams: { id: string; value: string }[];
  context?: string;
  contextWindow: number;
  supportsReasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  supportsFast: boolean;
  defaultFast: boolean;
  fastOverride?: boolean;
  /** Which reasoning-related parameters the model actually exposes. */
  parameterIds: {
    context: boolean;
    reasoning: boolean;
    effort: boolean;
    thinking: boolean;
    fast: boolean;
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────

function getParameter(item: CursorModelItem, id: string): CursorModelParameterDefinition | undefined {
  return item.parameters?.find((parameter) => parameter.id === id);
}

function hasBooleanValues(parameter: CursorModelParameterDefinition | undefined): boolean {
  const values = new Set((parameter?.values ?? []).map((entry) => entry.value.toLowerCase()));

  return values.has("false") && values.has("true");
}

function getParameterValue(parameter: CursorModelParameterDefinition | undefined, lowerValue: string): string | null {
  return parameter?.values.find((entry) => entry.value.toLowerCase() === lowerValue)?.value ?? null;
}

function getPreferredParameterValue(
  parameter: CursorModelParameterDefinition | undefined,
  lowerValues: string[],
): string | null {
  for (const candidate of lowerValues) {
    const found = getParameterValue(parameter, candidate);

    if (found) {
      return found;
    }
  }

  return null;
}

function cloneParams(params: { id: string; value: string }[]): { id: string; value: string }[] {
  return params.map((param) => ({ ...param }));
}

// ── Thinking levels ───────────────────────────────────────────────────────

/**
 * Derive pi's thinking-level map from the model's parameter definitions.
 * Returns `undefined` when the model exposes no reasoning control at all.
 */
export function deriveThinkingLevelMap(item: CursorModelItem): ThinkingLevelMap | undefined {
  const reasoning = getParameter(item, "reasoning");
  const effort = getParameter(item, "effort");
  const thinking = getParameter(item, "thinking");
  const valueParameter = effort ?? reasoning ?? thinking;

  if (!valueParameter) {
    return undefined;
  }

  if (valueParameter.id === "thinking" && hasBooleanValues(valueParameter)) {
    return {
      off: getParameterValue(valueParameter, "false"),
      minimal: null,
      low: null,
      medium: null,
      high: getParameterValue(valueParameter, "true"),
      xhigh: null,
      max: null,
    };
  }

  const comparable = (level: Exclude<keyof ThinkingLevelMap, "off">): string | null =>
    level === "xhigh"
      ? getPreferredParameterValue(valueParameter, ["xhigh", "extra-high"])
      : getParameterValue(valueParameter, level);

  return {
    off:
			getParameterValue(reasoning, "none") ??
			getParameterValue(reasoning, "off") ??
			getParameterValue(thinking, "false"),
    minimal: comparable("minimal"),
    low: comparable("low"),
    medium: comparable("medium"),
    high: comparable("high"),
    xhigh: comparable("xhigh"),
    max: comparable("max"),
  };
}

/** Default parameter set for a model: the default variant, or the first one. */
export function getDefaultParams(item: CursorModelItem): { id: string; value: string }[] {
  if (!item.variants?.length) {
    return [];
  }

  const variant = item.variants.find((candidate) => candidate.isDefault) ?? item.variants[0];

  return cloneParams(variant?.params ?? []);
}

// ── Context windows ───────────────────────────────────────────────────────

/** Parse a context label such as `200k` / `1m` into a token count. */
export function parseContextWindow(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([km])$/i.exec(value.trim());

  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount)) {
    return undefined;
  }

  return Math.round(amount * (match[2]?.toLowerCase() === "m" ? 1_000_000 : 1_000));
}

// ── Model identities ──────────────────────────────────────────────────────

export interface CursorModelIdentity {
  item: CursorModelItem;
  piModelId: string;
  selectionModelId: string;
  context?: string;
  fastOverride?: boolean;
  displayName: string;
}

function encodeModelId(modelId: string, context: string | undefined, fastOverride: boolean | undefined): string {
  const withContext = context ? `${modelId}@${context}` : modelId;

  if (fastOverride === true) {
    return `${withContext}:fast`;
  }

  if (fastOverride === false) {
    return `${withContext}:slow`;
  }

  return withContext;
}

function labelForModel(
  item: CursorModelItem,
  context: string | undefined,
  fastOverride: boolean | undefined,
): string {
  const qualifiers: string[] = [];

  if (fastOverride === true) {
    qualifiers.push("fast");
  }

  if (fastOverride === false) {
    qualifiers.push("slow");
  }

  const base = qualifiers.length > 0 ? `${item.displayName} (${qualifiers.join(", ")})` : item.displayName;

  return context ? `${base} @ ${context}` : base;
}

/**
 * Expand each catalog entry into the selectable pi model ids.
 *
 * Only the canonical model id is used as a selector (aliases are deliberately
 * dropped: upstream's alias handling adds ambiguity rules that buy little and
 * hide which model actually runs). Context and speed variants are kept because
 * they change the request, not just the label.
 */
export function buildModelIdentities(items: CursorModelItem[]): CursorModelIdentity[] {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const identities: CursorModelIdentity[] = [];

  for (const item of sorted) {
    if (!item.id?.trim()) {
      continue;
    }

    const contextValues = (getParameter(item, "context")?.values ?? []).map((entry) => entry.value);
    const contexts: (string | undefined)[] = contextValues.length > 0 ? contextValues : [undefined];
    const fastOverrides: (boolean | undefined)[] =
      getParameter(item, "fast") !== undefined ? [undefined, true, false] : [undefined];

    for (const context of contexts) {
      for (const fastOverride of fastOverrides) {
        const selectionModelId = item.id;
        const piModelId = encodeModelId(selectionModelId, context, fastOverride);

        if (seen.has(piModelId)) {
          continue;
        }

        seen.add(piModelId);
        identities.push({
          item,
          piModelId,
          selectionModelId,
          ...(context ? { context } : {}),
          ...(fastOverride === undefined ? {} : { fastOverride }),
          displayName: labelForModel(item, context, fastOverride),
        });
      }
    }
  }

  return identities;
}

// ── Catalog -> metadata registry ───────────────────────────────────────────

const metadataByPiModelId = new Map<string, CursorModelMetadata>();

/** Raw catalog behind the registered metadata; feeds the SDK's local validator. */
let registeredItems: CursorModelItem[] = [];

/** Drop all registered metadata. Tests use this to stay order-independent. */
export function resetModelCatalog(): void {
  metadataByPiModelId.clear();
  registeredItems = [];
}

/**
 * Context window for an identity. The catalog labels contexts such as `128k`
 * or `200k`; anything unparseable (including the catalog's own `default`
 * label) falls back to a conservative window rather than guessing.
 */
function contextWindowFor(context: string | undefined): number {
  if (context) {
    const parsed = parseContextWindow(context);

    if (parsed !== undefined) {
      return parsed;
    }
  }

  return CURSOR_FALLBACK_CONTEXT_WINDOW;
}

/**
 * Register catalog entries and return the resulting metadata.
 *
 * Registration replaces the whole catalog on purpose: the map must never hold
 * models from a previous refresh that no longer exist upstream.
 */
export function registerCatalog(items: CursorModelItem[]): CursorModelMetadata[] {
  resetModelCatalog();
  registeredItems = [...items];

  for (const identity of buildModelIdentities(items)) {
    const thinkingLevelMap = deriveThinkingLevelMap(identity.item);
    const defaultParams = getDefaultParams(identity.item);
    const contextParams = identity.context
      ? upsertParam(defaultParams, "context", identity.context)
      : defaultParams;
    const params =
      identity.fastOverride === undefined
        ? contextParams
        : upsertParam(contextParams, "fast", identity.fastOverride ? "true" : "false");
    const fastValue = params.find((param) => param.id === "fast")?.value.toLowerCase();

    metadataByPiModelId.set(identity.piModelId, {
      piModelId: identity.piModelId,
      selectionModelId: identity.selectionModelId,
      baseModelId: identity.item.id,
      displayName: identity.displayName,
      defaultParams: params,
      ...(identity.context ? { context: identity.context } : {}),
      contextWindow: contextWindowFor(identity.context),
      supportsReasoning: thinkingLevelMap !== undefined,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      supportsFast: getParameter(identity.item, "fast") !== undefined,
      defaultFast: fastValue === "true",
      ...(identity.fastOverride === undefined ? {} : { fastOverride: identity.fastOverride }),
      parameterIds: {
        context: getParameter(identity.item, "context") !== undefined,
        reasoning: getParameter(identity.item, "reasoning") !== undefined,
        effort: getParameter(identity.item, "effort") !== undefined,
        thinking: getParameter(identity.item, "thinking") !== undefined,
        fast: getParameter(identity.item, "fast") !== undefined,
      },
    });
  }

  return listModelMetadata();
}

/** Build the pi-ai `Model` record for one registered Cursor model. */
export function toPiModel(
  metadata: CursorModelMetadata,
  options: { providerId: string; api: string; baseUrl: string },
): Model<Api> {
  return {
    id: metadata.piModelId,
    name: metadata.displayName,
    api: options.api,
    provider: options.providerId,
    baseUrl: options.baseUrl,
    reasoning: metadata.supportsReasoning,
    ...(metadata.thinkingLevelMap ? { thinkingLevelMap: metadata.thinkingLevelMap } : {}),
    input: [...CURSOR_MODEL_INPUT],
    cost: { ...CURSOR_ZERO_COST },
    contextWindow: metadata.contextWindow,
    maxTokens: CURSOR_FALLBACK_MAX_TOKENS,
  };
}

/** Convenience: every registered model as a pi-ai `Model`. */
export function toPiModels(options: { providerId: string; api: string; baseUrl: string }): Model<Api>[] {
  return listModelMetadata().map((metadata) => toPiModel(metadata, options));
}

function upsertParam(params: { id: string; value: string }[], id: string, value: string): { id: string; value: string }[] {
  const next = params.map((param) => (param.id === id ? { id, value } : param));

  if (!next.some((param) => param.id === id)) {
    next.push({ id, value });
  }

  return next;
}

/**
 * Look up the metadata for a pi model id.
 *
 * @param piModelId - The registered pi model id.
 * @returns The metadata, or `undefined` when the id is unknown.
 */
export function getModelMetadata(piModelId: string): CursorModelMetadata | undefined {
  return metadataByPiModelId.get(piModelId);
}

/**
 * Every registered model, as copies the caller may mutate.
 *
 * @returns The registered metadata, one entry per selectable model.
 */
export function listModelMetadata(): CursorModelMetadata[] {
  return [...metadataByPiModelId.values()].map((metadata) => ({
    ...metadata,
    defaultParams: cloneParams(metadata.defaultParams),
    ...(metadata.thinkingLevelMap ? { thinkingLevelMap: { ...metadata.thinkingLevelMap } } : {}),
  }));
}

// ── Local catalog for the Cursor SDK ──────────────────────────────────────

/**
 * Reduce the catalog to the payload the SDK's local model validator consumes.
 *
 * Only `id` and `aliases` matter to the validator; display names and parameter
 * lists are ignored there.
 *
 * @param items - Raw catalog entries as returned by Cursor.
 * @returns Minimal `{ id, aliases }` entries, blank ids dropped.
 */
export function toSdkLocalCatalog(items: CursorModelItem[]): { id: string; aliases?: string[] }[] {
  const payload: { id: string; aliases?: string[] }[] = [];

  for (const item of items) {
    const id = item.id?.trim();

    if (!id) {
      continue;
    }

    const aliases = (item.aliases ?? []).filter((alias) => alias.trim().length > 0);

    payload.push(aliases.length > 0 ? { id, aliases: [...aliases] } : { id });
  }

  return payload;
}

/**
 * Serialize the catalog into the override payload the SDK reads from its
 * environment.
 *
 * @param items - Catalog entries; defaults to the last registered catalog.
 * @returns JSON array string, or `undefined` when there is nothing to publish.
 */
export function buildLocalCatalogJson(items: CursorModelItem[] = registeredItems): string | undefined {
  const payload = toSdkLocalCatalog(items);

  return payload.length > 0 ? JSON.stringify(payload) : undefined;
}

/**
 * Remember what this module last wrote, so `/cursor-models` can refresh its own
 * value while a value supplied by the user is left untouched.
 */
const publishedByEnv = new WeakMap<object, string>();

/**
 * Publish the catalog to `CURSOR_SDK_LOCAL_MODEL_CATALOG_JSON` so the SDK stops
 * asking the Cloud Agent endpoint (`GET /v1/models`) to validate local models.
 *
 * A value the user set is never overwritten: their override wins.
 *
 * @param options - Environment to write to and catalog to publish.
 * @returns `true` when the override was written.
 */
export function applyLocalModelCatalogEnv(
  options: { env?: Record<string, string | undefined>; items?: CursorModelItem[] } = {},
): boolean {
  const env = options.env ?? process.env;
  const json = buildLocalCatalogJson(options.items);

  if (!json) {
    return false;
  }

  const existing = env[CURSOR_LOCAL_CATALOG_ENV]?.trim();

  if (existing && existing !== publishedByEnv.get(env)) {
    return false;
  }

  env[CURSOR_LOCAL_CATALOG_ENV] = json;
  publishedByEnv.set(env, json);

  return true;
}

// ── Selection building ────────────────────────────────────────────────────

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Apply a pi thinking level onto the parameter list, mirroring how the Cursor
 * agent expects reasoning to be expressed: `effort` when the model has one,
 * otherwise `reasoning`, otherwise a boolean `thinking` flag.
 */
function applyThinkingLevel(
  metadata: CursorModelMetadata,
  params: { id: string; value: string }[],
  level: PiThinkingLevel,
): { id: string; value: string }[] {
  const mapped = metadata.thinkingLevelMap?.[level];

  if (mapped === undefined || mapped === null) {
    return params;
  }

  const { reasoning, effort, thinking } = metadata.parameterIds;

  if (level === "off") {
    if (reasoning) {
      return upsertParam(params, "reasoning", mapped);
    }

    if (thinking) {
      return upsertParam(params, "thinking", mapped);
    }

    return params;
  }

  if (effort) {
    const withThinking = thinking ? upsertParam(params, "thinking", "true") : params;

    return upsertParam(withThinking, "effort", mapped);
  }

  if (reasoning) {
    return upsertParam(params, "reasoning", mapped);
  }

  if (thinking) {
    return upsertParam(params, "thinking", mapped);
  }

  return params;
}

/**
 * Turn a pi model id plus the request's thinking level into the
 * `{ id, params }` selection the SDK expects.
 *
 * Unknown model ids degrade to `{ id: piModelId }`: the SDK rejects genuinely
 * invalid selections, and inventing parameters here would hide that.
 */
export function buildModelSelection(
  piModelId: string,
  thinkingLevel: PiThinkingLevel = "off",
  fastEnabled?: boolean,
): { id: string; params?: { id: string; value: string }[] } {
  const metadata = getModelMetadata(piModelId);

  if (!metadata) {
    return { id: piModelId };
  }

  let params = applyThinkingLevel(metadata, cloneParams(metadata.defaultParams), thinkingLevel);

  if (metadata.supportsFast && fastEnabled !== undefined) {
    params = upsertParam(params, "fast", fastEnabled ? "true" : "false");
  }

  return params.length > 0 ? { id: metadata.selectionModelId, params } : { id: metadata.selectionModelId };
}

// ── Static fallback catalog ───────────────────────────────────────────────

/**
 * Minimal catalog used when no key is configured yet or discovery fails.
 *
 * Its only job is to keep `/login cursor` and the model picker usable; the
 * live catalog replaces it as soon as a key exists. It is also what a Free
 * Cursor plan can run: `default` is Cursor's Auto router, the only model those
 * plans are allowed to select, so it must always be present.
 */
export const FALLBACK_CURSOR_MODELS: CursorModelItem[] = [
  {
    id: "default",
    displayName: "Auto",
    description: "Cursor's automatic model router. Available on every Cursor plan, including Free.",
  },
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    parameters: [
      {
        id: "effort",
        values: [{ value: "low" }, { value: "medium" }, { value: "high" }],
      },
    ],
  },
  {
    id: "composer-2",
    displayName: "Composer 2",
    parameters: [
      {
        id: "context",
        values: [{ value: "128k" }, { value: "200k" }],
      },
    ],
  },
];

// ── Discovery ─────────────────────────────────────────────────────────────

export interface DiscoverCatalogOptions {
  /** Key used for the live fetch. Without it, fall back to cache then static. */
  apiKey?: string;
  /** Skip the cache and always hit the API. */
  forceRefresh?: boolean;
  /**
	 * Skip the live fetch entirely. Defaults to pi's offline flag, because the
	 * Cursor SDK does not honor `--offline` on its own.
	 */
  offline?: boolean;
  /** Environment used for the offline default. Overridable for tests. */
  env?: Record<string, string | undefined>;
  /** Cache file override for tests. */
  cachePath?: string;
  /** TTL override for tests. */
  ttlMs?: number;
  /** Clock override for tests. */
  now?: number;
  /** Injectable loader; defaults to a dynamic `import("@cursor/sdk")`. */
  loadSdk?: () => Promise<{ Cursor: { models: { list(options?: { apiKey?: string }): Promise<CursorModelItem[]> } } }>;
}

/** True when pi was started with `--offline` / `PI_OFFLINE=1`. */
export function isOfflineMode(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[CURSOR_OFFLINE_ENV]?.trim().toLowerCase();

  return raw === "1" || raw === "true" || raw === "yes";
}

export interface DiscoverCatalogResult {
  metadata: CursorModelMetadata[];
  source: "live" | "cache" | "fallback";
  /** Scrubbed, human-readable reason when the source is not `live`. */
  note?: string;
  /**
	 * `true` when the note explains a Cursor plan limitation rather than a
	 * fault: a Free plan cannot read the Cloud Agent catalog, and the local one
	 * still runs. Startup stays silent and only `/cursor-models` reports it.
	 */
  quiet?: boolean;
}

function cacheKeyForCacheOverride(options: { cachePath?: string; ttlMs?: number; now?: number }) {
  return {
    ...(options.cachePath ? { path: options.cachePath } : {}),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

async function defaultLoadSdk() {
  return import("@cursor/sdk");
}

/**
 * In-flight catalog discoveries by normalized options (PERF-09). Concurrent
 * callers with equivalent options await the same promise instead of firing
 * duplicate SDK list calls and racing the cache write. Entries are removed
 * in a finally, so sequential calls with different options never collide.
 */
const pendingDiscoveries = new Map<string, Promise<DiscoverCatalogResult>>();

function discoveryFlightKey(options: DiscoverCatalogOptions, offline: boolean): string {
  return JSON.stringify({
    path: options.cachePath ?? getModelCachePath(),
    ttlMs: options.ttlMs ?? getModelCacheTtlMs(),
    forceRefresh: options.forceRefresh ?? false,
    hasKey: Boolean(options.apiKey),
    offline,
    now: options.now ?? null,
  });
}

/**
 * Resolve the model catalog: live API when a key is available, otherwise the
 * local cache, otherwise the static fallback. Never throws.
 */
export async function discoverCursorCatalog(
  options: DiscoverCatalogOptions = {},
): Promise<DiscoverCatalogResult> {
  const offline = options.offline ?? isOfflineMode(options.env ?? process.env);
  const key = discoveryFlightKey(options, offline);
  const pending = pendingDiscoveries.get(key);

  if (pending) {
    return pending;
  }

  const run = runDiscovery(options, offline);

  pendingDiscoveries.set(key, run);

  try {
    return await run;
  } finally {
    if (pendingDiscoveries.get(key) === run) {
      pendingDiscoveries.delete(key);
    }
  }
}

/**
 * Read one optional SDK error field without assuming the error's shape.
 *
 * @param error - Thrown value of unknown shape.
 * @param field - Field name to read.
 * @returns The field value, or `undefined` when the error has no such field.
 */
function errorField(error: unknown, field: string): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  return (error as Record<string, unknown>)[field];
}

/**
 * True when discovery was refused because the Cursor plan cannot read the Cloud
 * Agent catalog. That is a plan limitation, not a broken key or a broken
 * network, so callers keep it off the startup banner.
 *
 * @param error - Failure thrown by the Cursor SDK.
 * @returns Whether the failure is a `plan_required` refusal.
 */
export function isPlanBlockedError(error: unknown): boolean {
  return errorField(error, "code") === "plan_required" || errorField(error, "status") === 403;
}

/**
 * Turn a thrown discovery error into an actionable, scrubbed note.
 *
 * The SDK funnels almost every unmapped failure into `UnknownAgentError`, so
 * reporting `error.name` alone tells the user nothing. The message, `code` and
 * `status` are the identifying parts, and a `plan_required` answer gets its own
 * explanation because it is the common, fixable case: a Free Cursor plan cannot
 * read the Cloud Agent catalog.
 *
 * @param error - Failure thrown by the Cursor SDK.
 * @param apiKey - Key in use, so it can be redacted from the note.
 * @returns Single-line note for stderr and `/cursor-models`.
 */
export function describeDiscoveryFailure(error: unknown, apiKey?: string): string {
  const name = error instanceof Error && error.name ? error.name : "error";
  const message = scrubError(error, apiKey);
  const code = errorField(error, "code");
  const status = errorField(error, "status");
  const suffix = [
    typeof code === "string" && code ? `code=${code}` : undefined,
    typeof status === "number" ? `status=${status}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
  const detail = `${name}: ${message}${suffix ? ` (${suffix})` : ""}`;

  if (isPlanBlockedError(error)) {
    return (
      `Cursor model discovery failed (${detail}). The Cloud Agent model catalog needs a paid Cursor plan. ` +
			"pi-cursor keeps its local catalog, including Auto (model `default`), so local agents still run."
    );
  }

  return `Cursor model discovery failed (${detail}); using the local catalog.`;
}

async function runDiscovery(options: DiscoverCatalogOptions, offline: boolean): Promise<DiscoverCatalogResult> {
  const fromCache = (): DiscoverCatalogResult | undefined => {
    const cached = loadCachedCatalog(cacheKeyForCacheOverride(options));

    if (!cached) {
      return undefined;
    }

    return { metadata: registerCatalog(cached.models as CursorModelItem[]), source: "cache" };
  };

  if (!options.forceRefresh) {
    const cached = fromCache();

    if (cached) {
      return cached;
    }
  }

  if (!options.apiKey || offline) {
    const cached = options.forceRefresh ? undefined : fromCache();

    if (cached) {
      return cached;
    }

    return {
      metadata: registerCatalog(FALLBACK_CURSOR_MODELS),
      source: "fallback",
      note: offline
        ? "Offline mode: using the placeholder catalog and making no network request. Run pi without --offline to refresh."
        : "No Cursor API key configured; showing a placeholder catalog. Run /login cursor or set CURSOR_API_KEY.",
    };
  }

  try {
    const sdk = await (options.loadSdk ?? defaultLoadSdk)();
    const items = (await sdk.Cursor.models.list({ apiKey: options.apiKey })) as CursorModelItem[];

    if (items.length > 0) {
      saveCachedCatalog(items as CachedModelRecord[], {
        ...(options.cachePath ? { path: options.cachePath } : {}),
        ...(options.now === undefined ? {} : { now: options.now }),
      });

      return { metadata: registerCatalog(items), source: "live" };
    }

    const staleCache = fromCache();

    if (staleCache) {
      return staleCache;
    }

    return {
      metadata: registerCatalog(FALLBACK_CURSOR_MODELS),
      source: "fallback",
      note: "Cursor returned an empty model catalog; using the placeholder catalog.",
    };
  } catch (error) {
    const staleCache = fromCache();

    if (staleCache) {
      return staleCache;
    }

    return {
      metadata: registerCatalog(FALLBACK_CURSOR_MODELS),
      source: "fallback",
      note: describeDiscoveryFailure(error, options.apiKey),
      ...(isPlanBlockedError(error) ? { quiet: true } : {}),
    };
  }
}
