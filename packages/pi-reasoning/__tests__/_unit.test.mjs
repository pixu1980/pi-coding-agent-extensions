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
  formatEmojiText,
  formatLevelLabel,
  formatReasoningLevelChange,
} from "../lib/_levels.ts";
import { LEVEL_EMOJI, DEFAULT_MODEL_MAP, ALL_THINKING_LEVELS } from "../lib/_constants.ts";
import { assertCanonicalLabel, assertLevelLabel, spacesAfterEmoji } from "./_helpers.mjs";

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

// ── Unit: canonical emoji label rendering ─────────────────────────
//
// Regression guard: the level notifications used to render `❤️ high` (one
// space) while the menu rendered `❤️  high` (two), so the same level looked
// different depending on where it appeared.

test("formatEmojiText: one emoji, two spaces, then the text", () => {
  assert.equal(formatEmojiText("🧠", "auto"), "🧠  auto");
  assert.equal(spacesAfterEmoji(formatEmojiText("❤️", "high")), 2);
});

test("formatLevelLabel: separator per level (high/xhigh 2, rest 1)", () => {
  const expected = {
    off: "⚪ off",
    minimal: "💚 minimal",
    low: "💛 low",
    medium: "🧡 medium",
    high: "❤️  high",
    xhigh: "❤️‍🔥  xhigh",
    max: "🔥 max",
  };
  for (const level of ALL_THINKING_LEVELS) {
    const label = formatLevelLabel(level);
    assert.equal(label, expected[level]);
    assertLevelLabel(label, level);
  }
});

test("formatReasoningLevelChange: level mentions keep the optical separator", () => {
  assert.equal(formatReasoningLevelChange("high", "high"), `Reasoning level → ${LEVEL_EMOJI.high}  high`);
  assertLevelLabel(`${LEVEL_EMOJI.high}  high`, "high");

  // `max` requested on a model that can only reach `high` → rounded notice:
  // applied `high` keeps two spaces, the `max` mention takes one.
  const rounded = formatReasoningLevelChange("max", "high");
  assert.match(rounded, /\(rounded, your choice was /);
  const requestedMention = rounded.slice(rounded.indexOf("your choice was ") + "your choice was ".length);
  assertLevelLabel(requestedMention.slice(0, requestedMention.indexOf(")")), "max");
});

test("buildReasoningMenuOptions: every label uses the optical separator", () => {
  const options = buildReasoningMenuOptions({
    reasoning: true,
    thinkingLevelMap: { xhigh: "max", max: "max" },
  });
  for (const option of options) {
    if (option.value === "auto") assertCanonicalLabel(option.label);
    else assertLevelLabel(option.label, option.value);
  }
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

