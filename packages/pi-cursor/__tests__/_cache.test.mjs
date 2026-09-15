/**
 * pi-cursor - catalog cache suite
 *
 * The cache exists to keep startup fast. The security property is what it does
 * *not* contain: no key, and no key-derived value.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	getModelCachePath,
	getModelCacheTtlMs,
	isModelCacheDisabled,
	loadCachedCatalog,
	parseCatalog,
	saveCachedCatalog,
} from "../lib/_cache.ts";
import { CURSOR_MODEL_CACHE_VERSION } from "../lib/_types.ts";

const KEY = "crsr_live_0123456789abcdef";

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pi-cursor-cache-"));
}

describe("getModelCachePath", () => {
	it("uses the agent directory", () => {
		assert.equal(getModelCachePath("/tmp/agent"), "/tmp/agent/pi-cursor-models.json");
	});

	it("does not place the cache inside a cursor-owned directory", () => {
		const path = getModelCachePath("/tmp/agent");
		assert.equal(path.includes(".cursor"), false);
	});
});

describe("parseCatalog", () => {
	const good = { version: CURSOR_MODEL_CACHE_VERSION, fetchedAt: 1, models: [{ id: "grok-4.6", displayName: "Grok 4.6" }] };

	it("accepts a well-formed catalog", () => {
		const parsed = parseCatalog(JSON.stringify(good));
		assert.equal(parsed?.models.length, 1);
	});

	it("rejects a version mismatch", () => {
		assert.equal(parseCatalog(JSON.stringify({ ...good, version: 99 })), undefined);
	});

	it("rejects malformed payloads instead of throwing", () => {
		for (const raw of ["", "{", "null", "[]", JSON.stringify({ version: CURSOR_MODEL_CACHE_VERSION })]) {
			assert.equal(parseCatalog(raw), undefined, raw);
		}
	});

	it("drops unusable entries and keeps the rest", () => {
		const parsed = parseCatalog(
			JSON.stringify({ ...good, models: [{ id: "ok", displayName: "OK" }, { id: "" }, "nope", { id: "x" }] }),
		);
		assert.deepEqual(parsed?.models, [{ id: "ok", displayName: "OK" }]);
	});
});

describe("saveCachedCatalog / loadCachedCatalog", () => {
	it("round-trips and writes mode 0600", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "cache.json");
			assert.equal(saveCachedCatalog([{ id: "grok-4.6", displayName: "Grok 4.6" }], { path, now: 1000 }), true);
			assert.equal(statSync(path).mode & 0o777, 0o600);
			const loaded = loadCachedCatalog({ path, now: 1500, ttlMs: 10_000 });
			assert.equal(loaded?.models.length, 1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stores no key material", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "cache.json");
			saveCachedCatalog([{ id: "grok-4.6", displayName: "Grok 4.6" }], { path, now: 1000 });
			const raw = readFileSync(path, "utf8");
			for (const needle of [KEY, "apiKey", "api_key", "keyFingerprint", "fingerprint", "token", "credential"]) {
				assert.equal(raw.includes(needle), false, `cache must not contain ${needle}`);
			}
			const parsed = JSON.parse(raw);
			assert.deepEqual(Object.keys(parsed).sort(), ["fetchedAt", "models", "version"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats an expired catalog as absent", () => {
		const dir = tempDir();
		try {
			const path = join(dir, "cache.json");
			saveCachedCatalog([{ id: "grok-4.6", displayName: "Grok 4.6" }], { path, now: 0 });
			assert.equal(loadCachedCatalog({ path, now: 100_000, ttlMs: 1000 }), undefined);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns undefined for a missing file", () => {
		assert.equal(loadCachedCatalog({ path: join(tempDir(), "nope.json") }), undefined);
	});

	it("never persists an empty catalog", () => {
		const dir = tempDir();
		try {
			assert.equal(saveCachedCatalog([], { path: join(dir, "cache.json") }), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("env knobs", () => {
	it("reads the TTL override", () => {
		assert.equal(getModelCacheTtlMs({ PI_CURSOR_MODEL_CACHE_TTL_MS: "250" }), 250);
		assert.equal(getModelCacheTtlMs({ PI_CURSOR_MODEL_CACHE_TTL_MS: "nope" }) > 0, true);
		assert.equal(getModelCacheTtlMs({}) > 0, true);
	});

	it("reads the disable flag strictly", () => {
		assert.equal(isModelCacheDisabled({ PI_CURSOR_DISABLE_MODEL_CACHE: "1" }), true);
		assert.equal(isModelCacheDisabled({ PI_CURSOR_DISABLE_MODEL_CACHE: "true" }), false);
	});
});
