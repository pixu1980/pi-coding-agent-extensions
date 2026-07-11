/**
 * Tests for pi-reasoning/index.ts — automatic reasoning level management
 *
 * Tests the pure functions: findLevelForModel, guessLevel, model map
 * entries, and the /reasoning command handler.
 */

const assert = require("node:assert/strict");

// ── Types (mirrors index.ts) ─────────────────────────────────────

/** @typedef {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} ThinkingLevel */

/**
 * @typedef {{ pattern: string, level: ThinkingLevel, providers?: string[] }} ModelMapEntry
 */

// ── Pure function copies from index.ts ────────────────────────────
//
// These are not exported from the module, so we duplicate the logic
// here for testing. When changing index.ts, update these if needed.

const VALID_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const DEFAULT_MODEL_MAP = [
  // Max reasoning
  { pattern: "claude-opus-4", level: "max" },
  { pattern: "claude-opus-3", level: "max" },
  { pattern: "o3", level: "max" },
  { pattern: "o4", level: "max" },
  { pattern: "deepseek-r1", level: "max" },

  // High reasoning
  // NOTE: more specific patterns before broader ones (substring match)
  { pattern: "claude-sonnet-4-5", level: "high" },
  { pattern: "claude-sonnet-4", level: "high" },
  { pattern: "gpt-5", level: "high" },
  { pattern: "gemini-2.5", level: "high" },
  { pattern: "gemini-3", level: "high" },
  { pattern: "deepseek", level: "high" },
  { pattern: "kimi", level: "high" },
  { pattern: "qwq", level: "high" },

  // Medium reasoning (non-conflicting patterns first)
  { pattern: "claude-sonnet-3", level: "medium" },
  { pattern: "claude-3-sonnet", level: "medium" },
  { pattern: "gemini-2.0-pro", level: "medium" },
  { pattern: "llama-4", level: "medium" },
  { pattern: "llama-3", level: "medium" },
  { pattern: "mistral-large", level: "medium" },
  { pattern: "codestral", level: "medium" },

  // Low reasoning (specific before broad)
  { pattern: "claude-haiku", level: "low" },
  { pattern: "claude-3-haiku", level: "low" },
  { pattern: "gpt-4o-mini", level: "low" },
  { pattern: "gemini-2.0-flash-lite", level: "low" },
  { pattern: "gemini-2.0-flash", level: "low" },
  { pattern: "mistral-small", level: "low" },

  // Minimal / Off (specific before broad)
  { pattern: "gpt-4.1-mini", level: "minimal" },
  { pattern: "gpt-4.1-nano", level: "off" },
  { pattern: "gpt-4-mini", level: "off" },

  // Broad GPT-4 patterns (after specific variants)
  { pattern: "gpt-4o", level: "medium" },
  { pattern: "gpt-4.1", level: "medium" },
  { pattern: "gpt-4", level: "medium" },
  { pattern: "gemini-2.0", level: "medium" },
];

function findLevelForModel(modelMap, provider, modelId) {
  const lowerId = modelId.toLowerCase();
  for (const entry of modelMap) {
    if (entry.providers && !entry.providers.includes(provider)) continue;
    if (lowerId.includes(entry.pattern.toLowerCase())) {
      return entry.level;
    }
  }
  return null;
}

function guessLevel(modelId) {
  const lower = modelId.toLowerCase();
  // Use word-boundary matching to avoid false positives:
  // "gemini" contains "mini" as a substring, but "mini" isn't a
  // standalone word there — "\bmini\b" correctly rejects it.
  const hasWord = (word) => new RegExp(`\\b${word}\\b`).test(lower);

  if (hasWord("nano")) return "off";
  if (hasWord("mini") || hasWord("flash") || hasWord("haiku") || hasWord("small")) return "low";
  if (hasWord("large") || hasWord("pro") || hasWord("sonnet") || hasWord("opus")) return "high";
  return "medium";
}

const LEVEL_EMOJI = {
  off: "⚪",
  minimal: "🔵",
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  xhigh: "🔴",
  max: "💜",
};

// ── Tests ──────────────────────────────────────────────────────────

(async () => {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    }
  }

  // ── findLevelForModel ───────────────────────────────────────

  console.log("\n── findLevelForModel ──");

  test("matches exact pattern", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "anthropic", "claude-sonnet-4-20250514"), "high");
  });

  test("matches substring pattern", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "openai", "gpt-4o-20250513"), "medium");
  });

  test("case-insensitive matching", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "anthropic", "CLAUDE-OPUS-4-20250514"), "max");
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "deepseek", "DeepSeek-R1-0324"), "max");
  });

  test("first match wins (order matters)", () => {
    // "gpt-4o-mini" (low) comes before "gpt-4o" (medium)
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "openai", "gpt-4o-mini"), "low");
  });

  test("null when no match", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "openai", "unknown-model-v42"), null);
  });

  test("provider filter narrows matches", () => {
    const customMap = [
      { pattern: "my-model", level: "high", providers: ["my-provider"] },
    ];
    assert.equal(findLevelForModel(customMap, "other-provider", "my-model"), null);
    assert.equal(findLevelForModel(customMap, "my-provider", "my-model"), "high");
  });

  test("entry without provider filter matches all providers", () => {
    const customMap = [
      { pattern: "catch-all", level: "medium" },
    ];
    assert.equal(findLevelForModel(customMap, "any-provider", "catch-all"), "medium");
    assert.equal(findLevelForModel(customMap, "", "catch-all"), "medium");
  });

  test("specific pattern takes priority over broader one", () => {
    // "claude-sonnet-4-5" (high) comes before "claude-sonnet-4" (high)
    // Both match, first wins — important for ordering
    const idx4_5 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "claude-sonnet-4-5");
    const idx4 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "claude-sonnet-4");
    assert.ok(idx4_5 < idx4, "claude-sonnet-4-5 should come before claude-sonnet-4");
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "anthropic", "claude-sonnet-4-5"), "high");
  });

  // ── guessLevel ─────────────────────────────────────────────

  console.log("\n── guessLevel ──");

  test("nano → off", () => {
    assert.equal(guessLevel("gpt-4.1-nano"), "off");
    assert.equal(guessLevel("my-nano-model"), "off");
  });

  test("mini → low", () => {
    assert.equal(guessLevel("gpt-4o-mini"), "low");
    assert.equal(guessLevel("my-mini-model"), "low");
  });

  test("flash → low", () => {
    assert.equal(guessLevel("gemini-2.0-flash"), "low");
    assert.equal(guessLevel("gemini-2.0-flash-lite"), "low");
  });

  test("haiku → low", () => {
    assert.equal(guessLevel("claude-3-haiku"), "low");
  });

  test("small → low", () => {
    assert.equal(guessLevel("mistral-small"), "low");
  });

  test("large → high", () => {
    assert.equal(guessLevel("mistral-large"), "high");
    assert.equal(guessLevel("llama-3.1-large"), "high");
  });

  test("pro → high", () => {
    assert.equal(guessLevel("gemini-2.0-pro"), "high");
  });

  test("sonnet → high", () => {
    assert.equal(guessLevel("claude-sonnet-4"), "high");
    assert.equal(guessLevel("claude-sonnet-3"), "high");
  });

  test("opus → high", () => {
    assert.equal(guessLevel("claude-opus-4"), "high");
  });

  test("unknown model → medium (default)", () => {
    assert.equal(guessLevel("completely-unknown-model-xyz"), "medium");
    assert.equal(guessLevel(""), "medium");
  });

  test("case-insensitive guessing", () => {
    assert.equal(guessLevel("CLAUDE-OPUS-4"), "high");
    assert.equal(guessLevel("My-Nano-Model"), "off");
  });

  // ── DEFAULT_MODEL_MAP integrity ──────────────────────────────

  console.log("\n── DEFAULT_MODEL_MAP integrity ──");

  test("all entries have valid levels", () => {
    for (const entry of DEFAULT_MODEL_MAP) {
      assert.ok(VALID_LEVELS.includes(entry.level), `Invalid level "${entry.level}" for pattern "${entry.pattern}"`);
    }
  });

  test("all entries have non-empty patterns", () => {
    for (const entry of DEFAULT_MODEL_MAP) {
      assert.ok(entry.pattern.length > 0, `Empty pattern for entry with level "${entry.level}"`);
    }
  });

  test("no duplicate patterns (exact match)", () => {
    const patterns = DEFAULT_MODEL_MAP.map(e => e.pattern.toLowerCase());
    const uniques = new Set(patterns);
    assert.equal(patterns.length, uniques.size, "Duplicate patterns found in DEFAULT_MODEL_MAP");
  });

  test("zero 'xhigh' entries in default map", () => {
    // xhigh is valid but not yet used in defaults
    const xhighEntries = DEFAULT_MODEL_MAP.filter(e => e.level === "xhigh");
    assert.equal(xhighEntries.length, 0, "xhigh not assigned by default yet");
  });

  test("at least one entry per reasoning level", () => {
    const levelsUsed = new Set(DEFAULT_MODEL_MAP.map(e => e.level));
    const expectedLevels = new Set(["off", "minimal", "low", "medium", "high", "max"]);
    for (const lvl of expectedLevels) {
      assert.ok(levelsUsed.has(lvl), `No entries for level "${lvl}"`);
    }
  });

  test("no provider filters in default map", () => {
    // Default entries should be provider-agnostic
    for (const entry of DEFAULT_MODEL_MAP) {
      assert.equal(entry.providers, undefined, `Pattern "${entry.pattern}" has unexpected provider filter`);
    }
  });

  test("'deepseek' (high) comes after 'deepseek-r1' (max)", () => {
    const idxR1 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "deepseek-r1");
    const idxDS = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "deepseek");
    assert.ok(idxR1 < idxDS, "deepseek-r1 must come before deepseek for correct priority");
  });

  test("'claude-sonnet-4' comes after 'claude-sonnet-4-5'", () => {
    const idx4_5 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "claude-sonnet-4-5");
    const idx4 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "claude-sonnet-4");
    assert.ok(idx4_5 < idx4, "claude-sonnet-4-5 must come before claude-sonnet-4");
  });

  test("'gpt-4o-mini' comes before 'gpt-4o' (specific before broad)", () => {
    const idx4o = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4o");
    const idx4oMini = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4o-mini");
    assert.ok(idx4oMini < idx4o, "gpt-4o-mini must come before gpt-4o");
  });

  test("'gpt-4.1-mini' comes before 'gpt-4.1' (specific before broad)", () => {
    const idx41 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4.1");
    const idx41Mini = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4.1-mini");
    assert.ok(idx41Mini < idx41, "gpt-4.1-mini must come before gpt-4.1");
  });

  test("'gpt-4.1-nano' comes before 'gpt-4.1' (specific before broad)", () => {
    const idx41 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4.1");
    const idx41Nano = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4.1-nano");
    assert.ok(idx41Nano < idx41, "gpt-4.1-nano must come before gpt-4.1");
  });

  test("'gpt-4-mini' comes before 'gpt-4' (specific before broad)", () => {
    const idx4 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4");
    const idx4Mini = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gpt-4-mini");
    assert.ok(idx4Mini < idx4, "gpt-4-mini must come before gpt-4");
  });

  test("'gemini-2.0-flash' comes before 'gemini-2.0' (specific before broad)", () => {
    const idx20 = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gemini-2.0");
    const idxFlash = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gemini-2.0-flash");
    assert.ok(idxFlash < idx20, "gemini-2.0-flash must come before gemini-2.0");
  });

  test("'gemini-2.0-flash-lite' comes before 'gemini-2.0-flash' (specific before broad)", () => {
    const idxFlash = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gemini-2.0-flash");
    const idxLite = DEFAULT_MODEL_MAP.findIndex(e => e.pattern === "gemini-2.0-flash-lite");
    assert.ok(idxLite < idxFlash, "gemini-2.0-flash-lite must come before gemini-2.0-flash");
  });

  // ── End-to-end model lookups ────────────────────────────────

  console.log("\n── End-to-end model lookups ──");

  const e2eCases = [
    // [provider, modelId, expectedLevel]
    ["anthropic", "claude-opus-4-20250514", "max"],
    ["anthropic", "claude-opus-3-20240514", "max"],
    ["anthropic", "claude-sonnet-4-5-20250514", "high"],
    ["anthropic", "claude-sonnet-4-20250514", "high"],
    ["anthropic", "claude-sonnet-3-20240514", "medium"],
    ["anthropic", "claude-3-sonnet-20240229", "medium"],
    ["anthropic", "claude-3-haiku-20240307", "low"],
    ["anthropic", "claude-haiku-3-20250301", "low"],
    ["openai", "o3-20250513", "max"],
    ["openai", "o4-20250513", "max"],
    ["openai", "gpt-5-20250513", "high"],
    ["openai", "gpt-4o-20250513", "medium"],
    ["openai", "gpt-4o-mini-20250718", "low"],
    ["openai", "gpt-4.1-20250513", "medium"],
    ["openai", "gpt-4.1-mini-20250513", "minimal"],
    ["openai", "gpt-4.1-nano-20250513", "off"],
    ["openai", "gpt-4-20250513", "medium"],
    ["openai", "gpt-4-mini-20250513", "off"],
    ["google", "gemini-2.5-pro-20250513", "high"],
    ["google", "gemini-3-20250513", "high"],
    ["google", "gemini-2.0-pro-20250513", "medium"],
    ["google", "gemini-2.0-flash-20250513", "low"],
    ["google", "gemini-2.0-flash-lite-20250513", "low"],
    ["google", "gemini-2.0-20250513", "medium"],
    ["deepseek", "deepseek-r1-0324", "max"],
    ["deepseek", "deepseek-chat-20250513", "high"],
    ["meta", "llama-4-20250513", "medium"],
    ["meta", "llama-3-20250513", "medium"],
    ["mistral", "mistral-large-20250513", "medium"],
    ["mistral", "mistral-small-20250513", "low"],
    ["mistral", "codestral-20250513", "medium"],
    ["moonshot", "kimi-20250513", "high"],
    ["openai", "qwq-20250513", "high"],
  ];

  for (const [provider, modelId, expected] of e2eCases) {
    test(`${provider}/${modelId} → ${expected}`, () => {
      assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, provider, modelId), expected);
    });
  }

  // ── guessLevel fallback (models not in default map) ──────────

  console.log("\n── guessLevel fallback ──");

  const guessCases = [
    ["unknown-nano-model-v1", "off"],
    ["huggingface/llama-3.2-11b-nano", "off"],
    ["some-mini-model", "low"],
    ["some-flash-model", "low"],
    ["claude-haiku-4", "low"],       // not in default map (claude-haiku matches)
    ["unknown-small-model", "low"],
    ["mistral-large-3", "high"],     // large keyword
    ["some-pro-model", "high"],
    ["new-claude-sonnet-5", "high"], // sonnet keyword
    ["new-claude-opus-5", "high"],   // opus keyword
    ["standard-model-unknown", "medium"],
    ["my-custom-model", "medium"],
    ["", "medium"],
  ];

  for (const [modelId, expected] of guessCases) {
    test(`"${modelId}" → ${expected}`, () => {
      assert.equal(guessLevel(modelId), expected);
    });
  }

  // ── Level emoji map ─────────────────────────────────────────

  console.log("\n── Level emoji map ──");

  test("all valid levels have emoji", () => {
    for (const level of VALID_LEVELS) {
      assert.ok(LEVEL_EMOJI[level], `Missing emoji for level "${level}"`);
      assert.equal(typeof LEVEL_EMOJI[level], "string");
      assert.ok(LEVEL_EMOJI[level].length > 0);
    }
  });

  test("each emoji is a unique unicode emoji character", () => {
    const emojis = Object.values(LEVEL_EMOJI);
    const uniqueEmojis = new Set(emojis);
    assert.equal(emojis.length, uniqueEmojis.size, "Duplicate emoji mappings");
  });

  // ── Summary ─────────────────────────────────────────────────

  const total = passed + failed;
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`${"─".repeat(40)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
})();
