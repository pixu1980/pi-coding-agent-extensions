/**
 * pi-cursor - local model catalog cache
 *
 * The catalog is public model metadata (ids, display names, parameter lists),
 * so caching it is safe. What is *not* safe is caching anything derived from
 * the API key: upstream `pi-cursor-sdk` stores a SHA-256 fingerprint of the key
 * in its cache file, which turns a readable cache into an offline oracle for
 * key verification. pi-cursor stores no key material at all — only the catalog
 * and a timestamp — so the cache file has nothing to leak.
 *
 * File: `~/.pi/agent/pi-cursor-models.json`, mode 0600.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CURSOR_MODEL_CACHE_FILE, CURSOR_MODEL_CACHE_TTL_MS, CURSOR_MODEL_CACHE_VERSION } from "./_types.ts";

/** Minimal shape we persist. Deliberately not the SDK's full model object. */
export interface CachedModelRecord {
	id: string;
	displayName: string;
	description?: string;
	parameters?: { id: string; values: { value: string; displayName?: string }[] }[];
	variants?: { params: { id: string; value: string }[]; displayName: string; isDefault?: boolean }[];
}

export interface CachedCatalog {
	fetchedAt: number;
	models: CachedModelRecord[];
}

export interface CacheEnv {
	[key: string]: string | undefined;
}

export const CURSOR_MODEL_CACHE_DISABLE_ENV = "PI_CURSOR_DISABLE_MODEL_CACHE";
export const CURSOR_MODEL_CACHE_TTL_ENV = "PI_CURSOR_MODEL_CACHE_TTL_MS";

/** Resolve the cache path. Pass `agentDir` in tests to avoid touching `~`. */
export function getModelCachePath(agentDir?: string): string {
	return join(agentDir ?? defaultAgentDir(), CURSOR_MODEL_CACHE_FILE);
}

function defaultAgentDir(): string {
	// `getAgentDir` lives in the coding-agent bundle; the env fallbacks keep this
	// module importable (and unit-testable) without loading it.
	const fromEnv = process.env.PI_AGENT_DIR?.trim();
	if (fromEnv) return fromEnv;
	const configDir = process.env.PI_CONFIG_DIR?.trim() || ".pi";
	return join(process.env.HOME ?? process.env.USERPROFILE ?? ".", configDir, "agent");
}

export function isModelCacheDisabled(env: CacheEnv = process.env): boolean {
	return env[CURSOR_MODEL_CACHE_DISABLE_ENV] === "1";
}

export function getModelCacheTtlMs(env: CacheEnv = process.env): number {
	const raw = env[CURSOR_MODEL_CACHE_TTL_ENV];
	if (raw === undefined) return CURSOR_MODEL_CACHE_TTL_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : CURSOR_MODEL_CACHE_TTL_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a cache file, dropping anything malformed rather than throwing. */
export function parseCatalog(raw: string): CachedCatalog | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	if (parsed.version !== CURSOR_MODEL_CACHE_VERSION) return undefined;
	const fetchedAt = parsed.fetchedAt;
	if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return undefined;
	const models = parsed.models;
	if (!Array.isArray(models)) return undefined;
	const records: CachedModelRecord[] = [];
	for (const item of models) {
		if (!isRecord(item)) continue;
		const id = item.id;
		const displayName = item.displayName;
		if (typeof id !== "string" || !id.trim()) continue;
		if (typeof displayName !== "string") continue;
		records.push({
			id,
			displayName,
			...(typeof item.description === "string" ? { description: item.description } : {}),
			...(Array.isArray(item.parameters) ? { parameters: item.parameters as CachedModelRecord["parameters"] } : {}),
			...(Array.isArray(item.variants) ? { variants: item.variants as CachedModelRecord["variants"] } : {}),
		});
	}
	return records.length > 0 ? { fetchedAt, models: records } : undefined;
}

/** Read the cache. Returns `undefined` when absent, malformed, or stale. */
export function loadCachedCatalog(options: { path?: string; ttlMs?: number; now?: number } = {}): CachedCatalog | undefined {
	const path = options.path ?? getModelCachePath();
	try {
		if (!existsSync(path)) return undefined;
		const catalog = parseCatalog(readFileSync(path, "utf8"));
		if (!catalog) return undefined;
		const ttl = options.ttlMs ?? getModelCacheTtlMs();
		const now = options.now ?? Date.now();
		if (ttl >= 0 && now - catalog.fetchedAt > ttl) return undefined;
		return catalog;
	} catch {
		return undefined;
	}
}

/**
 * Write the cache with mode 0600.
 *
 * Returns `false` instead of throwing: a read-only or unwritable agent dir
 * must never break a chat turn.
 */
export function saveCachedCatalog(
	models: CachedModelRecord[],
	options: { path?: string; now?: number } = {},
): boolean {
	if (models.length === 0) return false;
	const path = options.path ?? getModelCachePath();
	try {
		const payload = {
			version: CURSOR_MODEL_CACHE_VERSION,
			fetchedAt: options.now ?? Date.now(),
			models,
		};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
		chmodSync(path, 0o600);
		return true;
	} catch {
		return false;
	}
}
