/**
 * pi-reasoning — Automatic reasoning level management for pi.dev
 *
 * Automatically sets the thinking/reasoning level based on the selected model.
 * Provides sensible defaults for common models and allows full customization
 * via the /reasoning command.
 *
 * Features:
 * - 🧠 Auto-reasoning: model change → optimal thinking level
 * - 📋 Sensible defaults for Claude, GPT, Gemini, DeepSeek, Llama, etc.
 * - ⚙️ /reasoning command: manual override, auto re-apply, or check current level
 * - 📊 Status bar indicator showing current reasoning level
 * - 🔌 Zero config — works out of the box with pi.dev's built-in models
 *
 * Install: pi install npm:@pixu1980/pi-reasoning
 * Requires: Node.js ≥ 22 (for --experimental-strip-types)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Types ──────────────────────────────────────────────────────────

type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

interface ModelMapEntry {
  /**
   * Substring to match against the model ID (e.g. "claude-sonnet-4",
   * "deepseek"). Matching is case-insensitive.
   */
  pattern: string;
  /** Thinking level to apply when this pattern matches */
  level: ThinkingLevel;
  /**
   * Optional provider filter — only apply this entry when the model
   * belongs to one of these providers (e.g. ["anthropic", "openai"]).
   */
  providers?: string[];
}

// ── Default Mappings ───────────────────────────────────────────────
//
// Maps model ID substrings to thinking levels. Entries are checked in
// order; the FIRST match wins. This means more specific patterns should
// come before broader ones.
//
// Naming convention:
//   pattern uses the model ID as known to pi (e.g. "claude-sonnet-4-20250514"
//   matches "claude-sonnet-4"). Case-insensitive substring match.

const DEFAULT_MODEL_MAP: ModelMapEntry[] = [
  // ── Max reasoning ──────────────────────────────────────────
  // Top-tier reasoning models where you want full depth
  { pattern: "claude-opus-4", level: "max" },
  { pattern: "claude-opus-3", level: "max" },
  { pattern: "o3", level: "max" },
  { pattern: "o4", level: "max" },
  { pattern: "deepseek-r1", level: "max" },

  // ── High reasoning ─────────────────────────────────────────
  // Strong reasoning models that benefit from deep thinking
  // NOTE: more specific patterns (e.g. "claude-sonnet-4-5") must
  // come before broader ones (e.g. "claude-sonnet-4") because
  // substring matching picks the FIRST match.
  { pattern: "claude-sonnet-4-5", level: "high" },
  { pattern: "claude-sonnet-4", level: "high" },
  { pattern: "gpt-5", level: "high" },
  { pattern: "gemini-2.5", level: "high" },
  { pattern: "gemini-3", level: "high" },
  { pattern: "deepseek", level: "high" },
  { pattern: "kimi", level: "high" },
  { pattern: "qwq", level: "high" },

  // ── Medium reasoning ───────────────────────────────────────
  // Balanced models — good reasoning without being overkill
  // NOTE: broader patterns like "gpt-4" go AFTER their more
  // specific variants (gpt-4o-mini, gpt-4.1-nano, etc.) so the
  // substring match finds the right level first.
  { pattern: "claude-sonnet-3", level: "medium" },
  { pattern: "claude-3-sonnet", level: "medium" },
  { pattern: "gemini-2.0-pro", level: "medium" },
  { pattern: "llama-4", level: "medium" },
  { pattern: "llama-3", level: "medium" },
  { pattern: "mistral-large", level: "medium" },
  { pattern: "codestral", level: "medium" },

  // ── Low reasoning ──────────────────────────────────────────
  // Fast models that can still benefit from a little thinking
  { pattern: "claude-haiku", level: "low" },
  { pattern: "claude-3-haiku", level: "low" },
  { pattern: "gpt-4o-mini", level: "low" },
  { pattern: "gemini-2.0-flash-lite", level: "low" },
  { pattern: "gemini-2.0-flash", level: "low" },
  { pattern: "mistral-small", level: "low" },

  // ── Minimal reasoning ──────────────────────────────────────
  // Very fast / cheap models — minimal thinking
  { pattern: "gpt-4.1-mini", level: "minimal" },
  { pattern: "gpt-4.1-nano", level: "off" },
  { pattern: "gpt-4-mini", level: "off" },

  // ── Broader GPT-4 patterns (after specific variants) ───────
  // These use substring matching, so they'd catch "gpt-4o-mini"
  // and "gpt-4.1-mini" before reaching here. We place them
  // AFTER all specific entries to avoid incorrect priority.
  { pattern: "gpt-4o", level: "medium" },
  { pattern: "gpt-4.1", level: "medium" },
  { pattern: "gpt-4", level: "medium" },
  { pattern: "gemini-2.0", level: "medium" },
];

// ── Extension Entry ────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  let modelMap: ModelMapEntry[] = [...DEFAULT_MODEL_MAP];

  // ── Notify on load ────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const currentLevel = pi.getThinkingLevel();
    const emoji = levelEmoji[currentLevel] ?? "🧠";
    const model = ctx.model;
    const modelLabel = model ? `${model.provider}/${model.id}` : "no model";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${currentLevel}`);
    ctx.ui.notify(`🧠 pi-reasoning loaded — ${emoji} ${currentLevel} (${modelLabel})`, "info");
  });

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Find the first matching thinking level for a model by scanning the
   * mapping entries in order. Returns `null` if no entry matches.
   */
  function findLevelForModel(
    provider: string,
    modelId: string,
  ): ThinkingLevel | null {
    const lowerId = modelId.toLowerCase();
    for (const entry of modelMap) {
      if (entry.providers && !entry.providers.includes(provider)) continue;
      if (lowerId.includes(entry.pattern.toLowerCase())) {
        return entry.level;
      }
    }
    return null;
  }

  /**
   * Apply the appropriate reasoning level for a given model.
   * - Model supports reasoning: look up in map, fall back to "medium"
   * - Model does NOT support reasoning: pi clamps to "off" automatically
   */
  function applyReasoningForModel(
    provider: string,
    modelId: string,
  ): void {
    if (!pi.getThinkingLevel) return; // guard: API not available

    const level = findLevelForModel(provider, modelId);
    if (level !== null) {
      pi.setThinkingLevel(level);
    }
  }

  /**
   * Guess a sensible fallback level for models not in the map.
   */
  function guessLevel(modelId: string): ThinkingLevel {
    const lower = modelId.toLowerCase();
    // Use word-boundary matching to avoid false positives:
    // "gemini" contains "mini" as a substring, but "mini" isn't a
    // standalone word there — "\bmini\b" correctly rejects it.
    const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(lower);

    if (hasWord("nano")) return "off";
    if (hasWord("mini") || hasWord("flash") || hasWord("haiku") || hasWord("small")) return "low";
    if (hasWord("large") || hasWord("pro") || hasWord("sonnet") || hasWord("opus")) return "high";
    return "medium";
  }

  // ── All available levels in order ──────────────────────────

  const ALL_THINKING_LEVELS: ThinkingLevel[] = [
    "off", "minimal", "low", "medium", "high", "xhigh", "max",
  ];

  /**
   * Get the subset of thinking levels available for a given model.
   *
   * Se il modello ha `thinkingLevelMap`:
   *   - null  → livello NON disponibile
   *   - omitted (undefined) → livelli standard (off..high) disponibili, xhigh/max NO
   *   - string → livello disponibile con quel valore
   *
   * Se il modello NON ha `thinkingLevelMap`:
   *   - reasoning: true  → tutti i livelli (xhigh/max potrebbero non funzionare)
   *   - reasoning: false → solo "off"
   */
  function getAvailableLevels(model?: { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null | undefined> }): ThinkingLevel[] {
    if (!model || !model.reasoning) return ["off"];

    const map = model.thinkingLevelMap;
    if (!map) {
      // No thinkingLevelMap: tutti i livelli sono potenzialmente disponibili
      return [...ALL_THINKING_LEVELS];
    }

    return ALL_THINKING_LEVELS.filter((level) => {
      const mapped = map[level];
      if (mapped === null) return false; // esplicitamente non supportato
      if (mapped === undefined) {
        // Non presente nella mappa: off..high supportati di default, xhigh/max no
        const idx = ALL_THINKING_LEVELS.indexOf(level);
        const highIdx = ALL_THINKING_LEVELS.indexOf("high");
        return idx <= highIdx;
      }
      return true; // string = supportato
    });
  }

  // ── Status bar indicator label ────────────────────────────────

  const STATUS_KEY = "reasoning";
  const levelEmoji: Record<ThinkingLevel, string> = {
    off: "⚪",
    minimal: "🔵",
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    xhigh: "🔴",
    max: "💜",
  };

  function updateStatusBar(level: ThinkingLevel): void {
    // Cannot directly modify status bar here — handled in events
  }

  // ── Model Select Event ────────────────────────────────────────
  //
  // Fired when the user changes model via /model, Ctrl+P cycling,
  // or session restore. We automatically set the thinking level to a
  // sensible default for the new model.
  //
  // On "restore" we skip auto-setting to preserve the user's saved level.

  pi.on("model_select", async (event, ctx) => {
    const { model, source } = event;

    // Skip on session restore — preserve the level the user had
    if (source === "restore") return;

    // Status bar: show current model reasoning capability
    const modelLabel = model.id.length > 20
      ? model.id.slice(0, 17) + "..."
      : model.id;

    if (!model.reasoning) {
      // Non-reasoning models: pi already clamps to "off"
      ctx.ui.setStatus(STATUS_KEY, `⚪ ${modelLabel}`);
      return;
    }

    // Look up in map, then fall back to heuristic
    const mapped = findLevelForModel(model.provider, model.id);
    const level = mapped ?? guessLevel(model.id);

    pi.setThinkingLevel(level);
    const emoji = levelEmoji[level] ?? "🧠";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${modelLabel}`);
  });

  // ── Thinking Level Select Event ───────────────────────────────
  //
  // Fired whenever the thinking level changes (via our auto-set,
  // manual /reasoning, keybinding, or pi clamping).
  // We keep the status bar in sync.

  pi.on("thinking_level_select", async (event, ctx) => {
    const emoji = levelEmoji[event.level] ?? "🧠";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${event.level}`);
  });

  // ── /reasoning Command ────────────────────────────────────────
  //
  // Usage:
  //   /reasoning            — interactive menu to pick level
  //   /reasoning off|minimal|low|medium|high|xhigh|max  — set manually
  //   /reasoning auto       — re-apply auto-reasoning for current model
  //   /reasoning reset      — restore default model map
  //   /reasoning map        — show active model→level mappings

  const LEVEL_EMOJI: Record<ThinkingLevel, string> = {
    off: "⚪",
    minimal: "🔵",
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    xhigh: "🔴",
    max: "💜",
  };

  function buildLevelOptions(available: ThinkingLevel[]): Array<{ label: string; value: ThinkingLevel }> {
    return available.map((level) => ({
      label: `${LEVEL_EMOJI[level]}  ${level}`,
      value: level,
    }));
  }

  pi.registerCommand("reasoning", {
    description:
      "Show or set the reasoning level. " +
      "Usage: /reasoning [off|minimal|low|medium|high|xhigh|max|auto|reset|map]",
    handler: async (args, ctx) => {
      const trimmed = args.trim().toLowerCase();

      // ── No args: show interactive menu, filtrato per modello ──
      if (!trimmed) {
        const model = ctx.model;
        const available = getAvailableLevels(model);
        const options = buildLevelOptions(available);

        // Titolo del menu con info sul modello
        const modelLabel = model ? `${model.provider}/${model.id}` : "nessun modello";
        const menuTitle = available.length < ALL_THINKING_LEVELS.length
          ? `🧠  ${modelLabel} — ${available.length}/${ALL_THINKING_LEVELS.length} livelli disponibili`
          : `🧠  Select reasoning level (${modelLabel})`;

        const choices = options.map((o) => o.label);
        const choice = await ctx.ui.select(menuTitle, choices);
        if (!choice) return; // user cancelled (Esc)

        const selected = options.find((o) => o.label === choice);
        if (selected) {
          pi.setThinkingLevel(selected.value);
          ctx.ui.notify(
            `Reasoning level → ${selected.label}`,
            "info",
          );
        }
        return;
      }

      // ── Auto: re-apply based on current model ────────────────
      if (trimmed === "auto" || trimmed === "automatic") {
        const model = ctx.model;
        if (!model) {
          ctx.ui.notify("No model currently selected", "warning");
          return;
        }

        if (!model?.reasoning) {
          ctx.ui.notify(
            `Model ${model.id} does not support reasoning`,
            "info",
          );
          return;
        }

        const mapped = findLevelForModel(model.provider, model.id);
        const level = mapped ?? guessLevel(model.id);
        pi.setThinkingLevel(level);
        const emoji = levelEmoji[level] ?? "🧠";
        ctx.ui.notify(
          `Auto-reasoning → ${emoji} ${level} (${model.provider}/${model.id})`,
          "info",
        );
        return;
      }

      // ── Reset: restore default model map ─────────────────────
      if (trimmed === "reset") {
        modelMap = [...DEFAULT_MODEL_MAP];
        ctx.ui.notify("Model map reset to defaults", "info");
        return;
      }

      // ── Map: show current mappings ──────────────────────────
      if (trimmed === "map" || trimmed === "list") {
        const lines = modelMap.map(
          (e) =>
            `  ${e.pattern.padEnd(24)} → ${e.level.padEnd(8)}${e.providers ? ` [${e.providers.join(", ")}]` : ""}`,
        );
        ctx.ui.notify(
          `Active mappings (${modelMap.length}):\n${lines.join("\n")}`,
          "info",
        );
        return;
      }

      // ── Set specific level ───────────────────────────────────
      const available = getAvailableLevels(ctx.model);
      if ((available as readonly string[]).includes(trimmed)) {
        pi.setThinkingLevel(trimmed as ThinkingLevel);
        const emoji = levelEmoji[trimmed as ThinkingLevel] ?? "🧠";
        ctx.ui.notify(`Reasoning level → ${emoji} ${trimmed}`, "info");
        return;
      }

      ctx.ui.notify(
        `Invalid level: "${trimmed}". ` +
          `Available: ${available.join(", ")}, auto, reset, map`,
        "warning",
      );
    },
  });
}
