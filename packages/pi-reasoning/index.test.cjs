/**
 * Tests for pi-reasoning/index.ts — automatic reasoning level management
 */

const assert = require("node:assert/strict");

// ── Pure function copies from index.ts ────────────────────────────

/** @typedef {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} ThinkingLevel */

const VALID_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const DEFAULT_MODEL_MAP = [
  { pattern: "claude-opus-4", level: "max" },
  { pattern: "claude-opus-3", level: "max" },
  { pattern: "o3", level: "max" },
  { pattern: "o4", level: "max" },
  { pattern: "deepseek-r1", level: "max" },
  { pattern: "claude-sonnet-4-5", level: "high" },
  { pattern: "claude-sonnet-4", level: "high" },
  { pattern: "gpt-5", level: "high" },
  { pattern: "gemini-2.5", level: "high" },
  { pattern: "gemini-3", level: "high" },
  { pattern: "deepseek", level: "high" },
  { pattern: "kimi", level: "high" },
  { pattern: "qwq", level: "high" },
  { pattern: "claude-sonnet-3", level: "medium" },
  { pattern: "claude-3-sonnet", level: "medium" },
  { pattern: "gemini-2.0-pro", level: "medium" },
  { pattern: "llama-4", level: "medium" },
  { pattern: "llama-3", level: "medium" },
  { pattern: "mistral-large", level: "medium" },
  { pattern: "codestral", level: "medium" },
  { pattern: "gpt-4o-mini", level: "low" },
  { pattern: "gemini-2.0-flash-lite", level: "low" },
  { pattern: "gemini-2.0-flash", level: "low" },
  { pattern: "mistral-small", level: "low" },
  { pattern: "claude-haiku", level: "low" },
  { pattern: "claude-3-haiku", level: "low" },
  { pattern: "gpt-4.1-mini", level: "minimal" },
  { pattern: "gpt-4.1-nano", level: "off" },
  { pattern: "gpt-4-mini", level: "off" },
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
  const hasWord = (word) => new RegExp(`\\b${word}\\b`).test(lower);
  if (hasWord("nano")) return "off";
  if (hasWord("mini") || hasWord("flash") || hasWord("haiku") || hasWord("small")) return "low";
  if (hasWord("large") || hasWord("pro") || hasWord("sonnet") || hasWord("opus")) return "high";
  return "medium";
}

// ── Tests ──────────────────────────────────────────────────────────

(async () => {
  const {
    getAvailableLevels,
    buildReasoningMenuOptions,
    default: registerReasoning,
    LEVEL_EMOJI,
  } = await import("./index.ts");

  let passed = 0;
  let failed = 0;
  const pendingTests = [];

  function reportSuccess(name) {
    passed++;
    console.log(`  ✓ ${name}`);
  }

  function reportFailure(name, err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }

  function test(name, fn) {
    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        pendingTests.push(Promise.resolve(result).then(
          () => reportSuccess(name),
          (err) => reportFailure(name, err),
        ));
        return;
      }
      reportSuccess(name);
    } catch (err) {
      reportFailure(name, err);
    }
  }

  // ── Model-specific reasoning menu ───────────────────────────

  console.log("\n── Model-specific reasoning menu ──");

  test("DeepSeek V4 keeps omitted standard levels and exposes max explicitly", () => {
    const options = buildReasoningMenuOptions({
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        max: "max",
      },
    });
    assert.deepEqual(options, [
      { value: "off", label: "⚪  off" },
      { value: "high", label: "❤️  high" },
      { value: "max", label: "🔥  max" },
      { value: "auto", label: "⚙️  auto" },
    ]);
  });

  test("qwen3.7-max without a map exposes only pi standard levels", () => {
    const options = buildReasoningMenuOptions({
      reasoning: true,
      id: "qwen3.7-max",
      provider: "opencode-go",
    });
    assert.deepEqual(options.map((option) => option.value), [
      "off", "minimal", "low", "medium", "high", "auto",
    ]);
  });

  test("non-reasoning model exposes only off and auto", () => {
    const options = buildReasoningMenuOptions({ reasoning: false });
    assert.deepEqual(options.map((option) => option.value), ["off", "auto"]);
  });

  test("explicit null hides a standard level while omitted standard levels remain available", () => {
    const options = buildReasoningMenuOptions({
      reasoning: true,
      thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
    });
    assert.deepEqual(options.map((option) => option.value), [
      "minimal", "low", "medium", "high", "xhigh", "max", "auto",
    ]);
  });

  test("autocomplete uses the current model and reveals map only when typed", () => {
    const events = new Map();
    let reasoningCommand;
    registerReasoning({
      getThinkingLevel: () => "off",
      on: (name, handler) => events.set(name, handler),
      registerCommand: (_name, command) => { reasoningCommand = command; },
      setThinkingLevel: () => {},
    });

    const model = {
      provider: "opencode-go",
      id: "deepseek-v4-flash",
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        max: "max",
      },
    };
    events.get("session_start")({}, {
      model,
      ui: { notify: () => {}, setStatus: () => {}, addAutocompleteProvider: () => {} },
    });

    assert.deepEqual(reasoningCommand.getArgumentCompletions(""), [
      { value: "off", label: "⚪  off" },
      { value: "high", label: "❤️  high" },
      { value: "max", label: "🔥  max" },
      { value: "auto", label: "⚙️  auto" },
    ]);
    assert.deepEqual(reasoningCommand.getArgumentCompletions("map"), [
      { value: "map", label: "map  — Show active model→level mappings" },
    ]);
  });

  test("SPACE uses the same Qwen menu as ENTER after session providers are installed", async () => {
    const events = new Map();
    let autocompleteFactory;
    const model = {
      provider: "opencode-go",
      id: "qwen3.7-max",
      reasoning: true,
    };
    const ui = {
      notify: () => {},
      setStatus: () => {},
      addAutocompleteProvider: (factory) => { autocompleteFactory = factory; },
    };

    registerReasoning({
      getThinkingLevel: () => "high",
      on: (name, handler) => events.set(name, handler),
      registerCommand: () => {},
      setThinkingLevel: () => {},
    });

    await events.get("session_start")({ reason: "startup" }, { model, ui });
    await events.get("resources_discover")({ reason: "startup" }, { model, ui });

    const baseProvider = {
      triggerCharacters: [],
      getSuggestions: async () => { throw new Error("base provider should not receive /reasoning"); },
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const provider = autocompleteFactory(baseProvider);
    const suggestions = await provider.getSuggestions(
      ["/reasoning "],
      0,
      "/reasoning ".length,
      { signal: new AbortController().signal },
    );

    assert.equal(suggestions.prefix, "");
    assert.deepEqual(
      suggestions.items.map(({ value, label }) => ({ value, label })),
      buildReasoningMenuOptions(model),
    );
    assert.equal(
      provider.shouldTriggerFileCompletion(["/reasoning "], 0, "/reasoning ".length),
      true,
      "SPACE reasoning completion must allow a forced refresh",
    );
  });

  test("manual xhigh on Qwen rounds to high with an explicit message", async () => {
    const events = new Map();
    let reasoningCommand;
    const selectedLevels = [];
    const notifications = [];
    const model = {
      provider: "opencode-go",
      id: "qwen3.7-max",
      reasoning: true,
    };

    registerReasoning({
      getThinkingLevel: () => "high",
      on: (name, handler) => events.set(name, handler),
      registerCommand: (_name, command) => { reasoningCommand = command; },
      setThinkingLevel: (level) => selectedLevels.push(level),
    });

    await reasoningCommand.handler("xhigh", {
      model,
      ui: { notify: (message, type) => notifications.push({ message, type }) },
    });

    assert.deepEqual(selectedLevels, ["high"]);
    assert.deepEqual(notifications, [{
      message: "Reasoning level → ❤️ high (rounded, your choice was ❤️‍🔥 xhigh)",
      type: "info",
    }]);
  });

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
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "openai", "gpt-4o-mini"), "low");
  });

  test("null when no match", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "openai", "unknown-model-v42"), null);
  });

  test("provider filter narrows matches", () => {
    const map = [{ pattern: "test", level: "high", providers: ["anthropic"] }];
    assert.equal(findLevelForModel(map, "anthropic", "test-model"), "high");
    assert.equal(findLevelForModel(map, "openai", "test-model"), null);
  });

  test("entry without provider filter matches all", () => {
    const map = [{ pattern: "test", level: "medium" }];
    assert.equal(findLevelForModel(map, "any-provider", "test-model"), "medium");
  });

  test("specific pattern takes priority over broader one", () => {
    assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, "anthropic", "claude-sonnet-4-5-20250514"), "high");
  });

  // ── guessLevel ──────────────────────────────────────────────

  console.log("\n── guessLevel ──");

  test("nano → off", () => assert.equal(guessLevel("some-nano-model"), "off"));
  test("mini → low", () => assert.equal(guessLevel("some-mini-model"), "low"));
  test("flash → low", () => assert.equal(guessLevel("some-flash-model"), "low"));
  test("haiku → low", () => assert.equal(guessLevel("claude-haiku-4"), "low"));
  test("small → low", () => assert.equal(guessLevel("unknown-small-model"), "low"));
  test("large → high", () => assert.equal(guessLevel("mistral-large-3"), "high"));
  test("pro → high", () => assert.equal(guessLevel("some-pro-model"), "high"));
  test("sonnet → high", () => assert.equal(guessLevel("new-claude-sonnet-5"), "high"));
  test("opus → high", () => assert.equal(guessLevel("new-claude-opus-5"), "high"));
  test("unknown model → medium (default)", () => assert.equal(guessLevel("standard-model-unknown"), "medium"));
  test("custom model → medium", () => assert.equal(guessLevel("my-custom-model"), "medium"));
  test("empty string → medium", () => assert.equal(guessLevel(""), "medium"));

  // ── DEFAULT_MODEL_MAP integrity ─────────────────────────────

  console.log("\n── DEFAULT_MODEL_MAP integrity ──");

  test("all entries have valid levels", () => {
    const validSet = new Set(VALID_LEVELS);
    for (const entry of DEFAULT_MODEL_MAP) {
      assert.ok(validSet.has(entry.level), `Invalid level "${entry.level}" in entry "${entry.pattern}"`);
    }
  });

  test("all entries have non-empty patterns", () => {
    for (const entry of DEFAULT_MODEL_MAP) {
      assert.ok(entry.pattern.length > 0, `Empty pattern found`);
    }
  });

  test("no duplicate patterns (exact match)", () => {
    const patterns = DEFAULT_MODEL_MAP.map((e) => e.pattern);
    const unique = new Set(patterns);
    assert.equal(patterns.length, unique.size, "Duplicate patterns found");
  });

  test("zero 'xhigh' entries in default map", () => {
    const xhighEntries = DEFAULT_MODEL_MAP.filter((e) => e.level === "xhigh");
    assert.equal(xhighEntries.length, 0, "xhigh should not appear in default map");
  });

  test("at least one entry per reasoning level", () => {
    const usedLevels = new Set(DEFAULT_MODEL_MAP.map((e) => e.level));
    const expectedLevels = new Set(["off", "minimal", "low", "medium", "high", "max"]);
    for (const level of expectedLevels) {
      assert.ok(usedLevels.has(level), `No entries for level "${level}"`);
    }
  });

  test("no provider filters in default map", () => {
    const filtered = DEFAULT_MODEL_MAP.filter((e) => e.providers);
    assert.equal(filtered.length, 0, "Default map should not have provider filters");
  });

  test("'deepseek' (high) comes after 'deepseek-r1' (max)", () => {
    const r1Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "deepseek-r1");
    const dsIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "deepseek");
    assert.ok(r1Idx < dsIdx, "deepseek-r1 must come before deepseek");
  });

  test("'claude-sonnet-4' comes after 'claude-sonnet-4-5'", () => {
    const s45Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "claude-sonnet-4-5");
    const s4Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "claude-sonnet-4");
    assert.ok(s45Idx < s4Idx, "claude-sonnet-4-5 must come before claude-sonnet-4");
  });

  test("'gpt-4o-mini' comes before 'gpt-4o' (specific before broad)", () => {
    const miniIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4o-mini");
    const gpt4oIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4o");
    assert.ok(miniIdx < gpt4oIdx);
  });

  test("'gpt-4.1-mini' comes before 'gpt-4.1'", () => {
    const miniIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4.1-mini");
    const g41Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4.1");
    assert.ok(miniIdx < g41Idx);
  });

  test("'gpt-4.1-nano' comes before 'gpt-4.1'", () => {
    const nanoIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4.1-nano");
    const g41Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4.1");
    assert.ok(nanoIdx < g41Idx);
  });

  test("'gpt-4-mini' comes before 'gpt-4'", () => {
    const miniIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4-mini");
    const g4Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gpt-4");
    assert.ok(miniIdx < g4Idx);
  });

  test("'gemini-2.0-flash' comes before 'gemini-2.0'", () => {
    const flashIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gemini-2.0-flash");
    const g20Idx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gemini-2.0");
    assert.ok(flashIdx < g20Idx);
  });

  test("'gemini-2.0-flash-lite' comes before 'gemini-2.0-flash'", () => {
    const liteIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gemini-2.0-flash-lite");
    const flashIdx = DEFAULT_MODEL_MAP.findIndex((e) => e.pattern === "gemini-2.0-flash");
    assert.ok(liteIdx < flashIdx);
  });

  // ── End-to-end model lookups ────────────────────────────────

  console.log("\n── End-to-end model lookups ──");

  const lookupTests = [
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

  for (const [provider, modelId, expected] of lookupTests) {
    test(`${provider}/${modelId} → ${expected}`, () => {
      assert.equal(findLevelForModel(DEFAULT_MODEL_MAP, provider, modelId), expected);
    });
  }

  // ── guessLevel fallback ─────────────────────────────────────

  console.log("\n── guessLevel fallback ──");

  test('"unknown-nano-model-v1" → off', () => assert.equal(guessLevel("unknown-nano-model-v1"), "off"));
  test('"huggingface/llama-3.2-11b-nano" → off', () => assert.equal(guessLevel("huggingface/llama-3.2-11b-nano"), "off"));
  test('"some-mini-model" → low', () => assert.equal(guessLevel("some-mini-model"), "low"));
  test('"some-flash-model" → low', () => assert.equal(guessLevel("some-flash-model"), "low"));
  test('"claude-haiku-4" → low', () => assert.equal(guessLevel("claude-haiku-4"), "low"));
  test('"unknown-small-model" → low', () => assert.equal(guessLevel("unknown-small-model"), "low"));
  test('"mistral-large-3" → high', () => assert.equal(guessLevel("mistral-large-3"), "high"));
  test('"some-pro-model" → high', () => assert.equal(guessLevel("some-pro-model"), "high"));
  test('"new-claude-sonnet-5" → high', () => assert.equal(guessLevel("new-claude-sonnet-5"), "high"));
  test('"new-claude-opus-5" → high', () => assert.equal(guessLevel("new-claude-opus-5"), "high"));
  test('"standard-model-unknown" → medium', () => assert.equal(guessLevel("standard-model-unknown"), "medium"));
  test('"my-custom-model" → medium', () => assert.equal(guessLevel("my-custom-model"), "medium"));
  test('"" → medium', () => assert.equal(guessLevel(""), "medium"));

  // ── Level emoji map ─────────────────────────────────────────

  console.log("\n── Level emoji map ──");

  test("all valid levels have emoji", () => {
    for (const level of VALID_LEVELS) {
      assert.ok(LEVEL_EMOJI[level], `Missing emoji for level "${level}"`);
    }
  });

  test("each emoji is a unique unicode emoji character", () => {
    const emojis = Object.values(LEVEL_EMOJI);
    const unique = new Set(emojis);
    assert.equal(emojis.length, unique.size, "Duplicate emojis found");
  });

  // ── Summary ─────────────────────────────────────────────────

  await Promise.all(pendingTests);

  console.log(`\n────────────────────────────────────────`);
  console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
  console.log(`────────────────────────────────────────\n`);

  process.exit(failed > 0 ? 1 : 0);
})();
