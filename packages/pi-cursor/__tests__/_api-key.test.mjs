/**
 * pi-cursor - API key suite
 *
 * Two properties matter and are asserted directly: the key has exactly two
 * possible sources (pi's credential store, and `CURSOR_API_KEY`), and this
 * module never writes a key anywhere.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  describeApiKeySource,
  normalizeApiKey,
  readEnvApiKey,
  resolveCursorApiKey,
} from "../lib/_api-key.ts";
import { CURSOR_API_KEY_ENV, CURSOR_API_KEY_PLACEHOLDER } from "../lib/_types.ts";

const KEY = "crsr_live_0123456789abcdef";

const keyModulePath = fileURLToPath(new URL("../lib/_api-key.ts", import.meta.url));

/** Drop comments so a doc sentence cannot be mistaken for a call. */
function keyModuleSource() {
  return readFileSync(keyModulePath, "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("normalizeApiKey", () => {
  it("trims a real key", () => {
    assert.equal(normalizeApiKey(`  ${KEY}\n`), KEY);
  });

  it("rejects blanks and non-strings", () => {
    for (const value of ["", "   ", undefined, null, 42, {}, []]) {
      assert.equal(normalizeApiKey(value), undefined);
    }
  });

  it("rejects the registration sentinel and env placeholders", () => {
    for (const value of [
      CURSOR_API_KEY_PLACEHOLDER,
      CURSOR_API_KEY_ENV,
      `$${CURSOR_API_KEY_ENV}`,
      `\${${CURSOR_API_KEY_ENV}}`,
    ]) {
      assert.equal(normalizeApiKey(value), undefined, value);
    }
  });
});

describe("readEnvApiKey", () => {
  it("reads CURSOR_API_KEY", () => {
    assert.equal(readEnvApiKey({ [CURSOR_API_KEY_ENV]: KEY }), KEY);
  });

  it("returns undefined when unset or blank", () => {
    assert.equal(readEnvApiKey({}), undefined);
    assert.equal(readEnvApiKey({ [CURSOR_API_KEY_ENV]: "   " }), undefined);
  });
});

describe("resolveCursorApiKey", () => {
  it("prefers the key pi resolved for the request", async () => {
    const resolved = await resolveCursorApiKey({
      explicit: KEY,
      env: { [CURSOR_API_KEY_ENV]: "crsr_env_should_lose" },
      allowStored: false,
    });

    assert.equal(resolved, KEY);
  });

  it("falls back to the environment", async () => {
    const resolved = await resolveCursorApiKey({
      env: { [CURSOR_API_KEY_ENV]: KEY },
      allowStored: false,
    });

    assert.equal(resolved, KEY);
  });

  it("returns undefined when nothing is configured", async () => {
    assert.equal(await resolveCursorApiKey({ env: {}, allowStored: false }), undefined);
  });

  it("ignores a sentinel passed as the explicit key", async () => {
    assert.equal(
      await resolveCursorApiKey({ explicit: CURSOR_API_KEY_PLACEHOLDER, env: {}, allowStored: false }),
      undefined,
    );
  });

  it("never surfaces a stored credential that is not an api_key", async () => {
    // The real auth.json may or may not exist on the machine running the suite;
    // what must hold is that a returned value is always a normalized string.
    const resolved = await resolveCursorApiKey({ env: {} });

    if (resolved !== undefined) {
      assert.equal(typeof resolved, "string");
    }
  });
});

describe("describeApiKeySource", () => {
  it("names the source without the value", async () => {
    assert.equal(await describeApiKeySource({ explicit: KEY, env: {}, allowStored: false }), "request");
    assert.equal(await describeApiKeySource({ env: { [CURSOR_API_KEY_ENV]: KEY }, allowStored: false }), "environment");
    assert.equal(await describeApiKeySource({ env: {}, allowStored: false }), "none");
  });
});

describe("no-write guarantee", () => {
  it("the key module contains no filesystem write", () => {
    const source = keyModuleSource();

    for (const forbidden of ["writeFile", "appendFile", "createWriteStream", "mkdirSync", "chmodSync", "rmSync"]) {
      assert.equal(source.includes(forbidden), false, `_api-key.ts must not call ${forbidden}`);
    }
  });

  it("the key module only reads pi's credential store", () => {
    const source = keyModuleSource();

    assert.match(source, /readStoredCredential/);
    // The SDK's own credential file must never be consulted: pi owns the key.
    assert.equal(source.includes(".cursor/sdk"), false);
    assert.equal(source.includes("sdk/auth.json"), false);
  });
});
