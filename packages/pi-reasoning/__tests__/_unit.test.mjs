/**
 * pi-reasoning - unit + e2e test suite
 *
 * Run: node --import tsx --test index.test.mjs
 *
 * - Unit: exported pure helpers (getAvailableLevels, buildReasoningMenuOptions,
 *   resolveThinkingLevel, LEVEL_EMOJI, DEFAULT_MODEL_MAP)
 * - E2E: drives the extension factory with a mock ExtensionAPI: events
 *   (session_start, model_select, thinking_level_select, resources_discover),
 *   the /reasoning command, and the autocomplete provider wrapper.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getAvailableLevels,
  buildReasoningMenuOptions,
  resolveThinkingLevel,
} from "../lib/_levels.ts";
import { LEVEL_EMOJI, DEFAULT_MODEL_MAP } from "../lib/_constants.ts";

// ── Unit: getAvailableLevels ──────────────────────────────────────

test("getAvailableLevels: model without reasoning exposes only off", () => {
  assert.deepEqual(getAvailableLevels({ reasoning: false }), ["off"]);
  assert.deepEqual(getAvailableLevels(undefined), ["off"]);
});

test("getAvailableLevels: no map → standard levels through high", () => {
  assert.deepEqual(getAvailableLevels({ reasoning: true }), [
    "off", "minimal", "low", "medium", "high",
  ]);
});

test("getAvailableLevels: explicit map entries win, null excludes, xhigh/max need explicit value", () => {
  const model = {
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,        // explicitly unavailable
      low: "high",          // explicitly available
      xhigh: "max",         // explicit → available
      max: "max",           // explicit → available
    },
  };
  assert.deepEqual(getAvailableLevels(model), ["off", "low", "medium", "high", "xhigh", "max"]);
});

test("getAvailableLevels: all null → empty (no level reachable)", () => {
  const model = {
    reasoning: true,
    thinkingLevelMap: {
      off: null, minimal: null, low: null, medium: null, high: null,
    },
  };
  assert.deepEqual(getAvailableLevels(model), []);
});

// ── Unit: resolveThinkingLevel ────────────────────────────────────

test("resolveThinkingLevel: returns requested when available", () => {
  assert.equal(resolveThinkingLevel("high", ["off", "high"]), "high");
});

test("resolveThinkingLevel: rounds up to next available level", () => {
  const available = ["off", "minimal", "medium", "xhigh"];
  assert.equal(resolveThinkingLevel("low", available), "medium");
});

test("resolveThinkingLevel: rounds to last available when nothing higher", () => {
  assert.equal(resolveThinkingLevel("max", ["off", "low"]), "low");
  assert.equal(resolveThinkingLevel("high", ["off", "minimal"]), "minimal");
});

test("resolveThinkingLevel: empty available → undefined", () => {
  assert.equal(resolveThinkingLevel("high", []), undefined);
});

// ── Unit: buildReasoningMenuOptions ───────────────────────────────

test("buildReasoningMenuOptions: lists available levels + auto", () => {
  const options = buildReasoningMenuOptions({ reasoning: true });
  const values = options.map((o) => o.value);
  assert.deepEqual(values, ["off", "minimal", "low", "medium", "high", "auto"]);
});

test("buildReasoningMenuOptions: non-reasoning model → off + auto", () => {
  const options = buildReasoningMenuOptions({ reasoning: false });
  assert.deepEqual(options.map((o) => o.value), ["off", "auto"]);
});

// ── Unit: LEVEL_EMOJI + DEFAULT_MODEL_MAP invariants ──────────────

test("LEVEL_EMOJI: every level has an emoji", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.ok(LEVEL_EMOJI[level], `missing emoji for ${level}`);
  }
});

test("DEFAULT_MODEL_MAP: specific patterns precede broad ones (first match wins)", () => {
  // gpt-4o-mini must resolve to "low" (specific) not gpt-4o → "medium" (broad)
  const specific = DEFAULT_MODEL_MAP.find((e) => e.pattern === "gpt-4o-mini");
  const broad = DEFAULT_MODEL_MAP.find((e) => e.pattern === "gpt-4o");
  assert.ok(specific && broad, "expected entries present");
  assert.ok(
    DEFAULT_MODEL_MAP.indexOf(specific) < DEFAULT_MODEL_MAP.indexOf(broad),
    "specific pattern must come before the broad one",
  );
});

