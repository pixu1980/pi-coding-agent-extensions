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
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Thinking levels as defined by pi.dev.
 * This is the canonical order — matches what pi.dev exposes via
 * model.thinkingLevelMap and SHIFT+TAB native autocomplete.
 */
type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

interface ModelMapEntry {
  /** Substring to match against the model ID. Case-insensitive. */
  pattern: string;
  /** Thinking level to apply when this pattern matches */
  level: ThinkingLevel;
  /** Optional provider filter */
  providers?: string[];
}

// ── Default Mappings ───────────────────────────────────────────────
//
// Maps model ID substrings to thinking levels. Entries are checked in
// order; the FIRST match wins. More specific patterns first.

const DEFAULT_MODEL_MAP: ModelMapEntry[] = [
  // ── Max reasoning ──────────────────────────────────────────
  { pattern: "claude-opus-4", level: "max" },
  { pattern: "claude-opus-3", level: "max" },
  { pattern: "o3", level: "max" },
  { pattern: "o4", level: "max" },
  { pattern: "deepseek-r1", level: "max" },

  // ── High reasoning ─────────────────────────────────────────
  { pattern: "claude-sonnet-4-5", level: "high" },
  { pattern: "claude-sonnet-4", level: "high" },
  { pattern: "gpt-5", level: "high" },
  { pattern: "gemini-2.5", level: "high" },
  { pattern: "gemini-3", level: "high" },
  { pattern: "deepseek", level: "high" },
  { pattern: "kimi", level: "high" },
  { pattern: "qwq", level: "high" },

  // ── Medium reasoning ───────────────────────────────────────
  { pattern: "claude-sonnet-3", level: "medium" },
  { pattern: "claude-3-sonnet", level: "medium" },
  { pattern: "gemini-2.0-pro", level: "medium" },
  { pattern: "llama-4", level: "medium" },
  { pattern: "llama-3", level: "medium" },
  { pattern: "mistral-large", level: "medium" },
  { pattern: "codestral", level: "medium" },

  // ── Low reasoning ──────────────────────────────────────────
  { pattern: "gpt-4o-mini", level: "low" },
  { pattern: "gemini-2.0-flash-lite", level: "low" },
  { pattern: "gemini-2.0-flash", level: "low" },
  { pattern: "mistral-small", level: "low" },

  // ── Minimal reasoning ──────────────────────────────────────
  { pattern: "claude-haiku", level: "low" },
  { pattern: "claude-3-haiku", level: "low" },
  { pattern: "gpt-4.1-mini", level: "minimal" },

  // ── Off ────────────────────────────────────────────────────
  { pattern: "gpt-4.1-nano", level: "off" },
  { pattern: "gpt-4-mini", level: "off" },

  // ── Broader patterns (after specific variants) ─────────────
  { pattern: "gpt-4o", level: "medium" },
  { pattern: "gpt-4.1", level: "medium" },
  { pattern: "gpt-4", level: "medium" },
  { pattern: "gemini-2.0", level: "medium" },
];

/**
 * All thinking levels in canonical order (matches pi.dev).
 */
const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

/** Levels enabled by pi.dev when a map key is omitted. */
const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high",
];

/** Emoji mapping requested for pi-reasoning menus and status. */
export const LEVEL_EMOJI: Record<ThinkingLevel, string> = {
  off: "⚪",
  minimal: "💚",
  low: "💛",
  medium: "🧡",
  high: "❤️",
  xhigh: "❤️‍🔥",
  max: "🔥",
};

type ReasoningModelCapabilities = {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null | undefined>;
};

/**
 * Returns the thinking levels available for a given model.
 * Uses pi's effective model descriptor (`thinkingLevelMap`) as the
 * source of truth for what the selected model supports.
 *
 * - Omitted key → standard levels through `high` are available by default
 * - String value → level is explicitly available
 * - `null` value → level is unavailable
 * - `xhigh` and `max` require an explicit string value
 */
export function getAvailableLevels(model?: ReasoningModelCapabilities): ThinkingLevel[] {
  if (!model?.reasoning) return ["off"];

  return ALL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (mapped !== undefined) return true;
    return STANDARD_THINKING_LEVELS.includes(level);
  });
}

/**
 * Build menu options for the /reasoning command.
 * Shows only levels the model actually supports + "auto".
 */
export function buildReasoningMenuOptions(
  model?: ReasoningModelCapabilities,
): Array<{ value: ThinkingLevel | "auto"; label: string }> {
  return [
    ...getAvailableLevels(model).map((level) => ({
      value: level,
      label: `${LEVEL_EMOJI[level]}  ${level}`,
    })),
    { value: "auto" as const, label: "⚙️  auto" },
  ];
}

/** Resolve an unsupported request to a supported thinking level. */
export function resolveThinkingLevel(
  requested: ThinkingLevel,
  available: readonly ThinkingLevel[],
): ThinkingLevel | undefined {
  if (available.length === 0) return undefined;
  if (available.includes(requested)) return requested;

  const requestedIndex = ALL_THINKING_LEVELS.indexOf(requested);
  return available.find((level) => ALL_THINKING_LEVELS.indexOf(level) > requestedIndex)
    ?? available[available.length - 1];
}

function formatReasoningLevelChange(requested: ThinkingLevel, applied: ThinkingLevel): string {
  const rounded = requested === applied
    ? ""
    : ` (rounded, your choice was ${LEVEL_EMOJI[requested]} ${requested})`;
  return `Reasoning level → ${LEVEL_EMOJI[applied]} ${applied}${rounded}`;
}

// ── Extension Entry ────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  let modelMap: ModelMapEntry[] = [...DEFAULT_MODEL_MAP];

  let currentModel: {
    provider: string;
    id: string;
    reasoning?: boolean;
    thinkingLevelMap?: Record<string, string | null | undefined>;
  } | undefined;

  // ── Notify on load ────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const currentLevel = pi.getThinkingLevel();
    const emoji = LEVEL_EMOJI[currentLevel] ?? "🧠";
    const model = ctx.model;
    currentModel = model;
    const modelLabel = model ? `${model.provider}/${model.id}` : "no model";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${currentLevel}`);
    ctx.ui.notify(`🧠 pi-reasoning loaded — ${emoji} ${currentLevel} (${modelLabel})`, "info");
  });

  // Register after every extension has handled session_start. This keeps
  // pi-reasoning as the outermost /reasoning autocomplete provider, so SPACE
  // and ENTER share buildReasoningMenuOptions regardless of package order.
  pi.on("resources_discover", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider(
      (current: AutocompleteProvider) => createReasoningAutocompleteProvider(current),
    );
  });

  // ── Helpers ──────────────────────────────────────────────────

  function findLevelForModel(provider: string, modelId: string): ThinkingLevel | null {
    const lowerId = modelId.toLowerCase();
    for (const entry of modelMap) {
      if (entry.providers && !entry.providers.includes(provider)) continue;
      if (lowerId.includes(entry.pattern.toLowerCase())) {
        return entry.level;
      }
    }
    return null;
  }

  function guessLevel(modelId: string): ThinkingLevel {
    const lower = modelId.toLowerCase();
    const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(lower);

    if (hasWord("nano")) return "off";
    if (hasWord("mini") || hasWord("flash") || hasWord("haiku") || hasWord("small")) return "low";
    if (hasWord("large") || hasWord("pro") || hasWord("sonnet") || hasWord("opus")) return "high";
    return "medium";
  }

  // ── Status bar ──────────────────────────────────────────────

  const STATUS_KEY = "reasoning";

  // ── Model Select Event ──────────────────────────────────────

  pi.on("model_select", async (event, ctx) => {
    const { model, source } = event;
    currentModel = model;

    if (source === "restore") return;

    const modelLabel = model.id.length > 20
      ? model.id.slice(0, 17) + "..."
      : model.id;

    if (!model.reasoning) {
      ctx.ui.setStatus(STATUS_KEY, `⚪ ${modelLabel}`);
      return;
    }

    const mapped = findLevelForModel(model.provider, model.id);
    const level = mapped ?? guessLevel(model.id);

    const safeLevel = resolveThinkingLevel(level, getAvailableLevels(model));
    if (!safeLevel) {
      ctx.ui.setStatus(STATUS_KEY, `🧠 ${modelLabel}`);
      return;
    }

    pi.setThinkingLevel(safeLevel);
    const emoji = LEVEL_EMOJI[safeLevel] ?? "🧠";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${modelLabel}`);
  });

  // ── Thinking Level Select Event ─────────────────────────────

  pi.on("thinking_level_select", async (event, ctx) => {
    const emoji = LEVEL_EMOJI[event.level] ?? "🧠";
    ctx.ui.setStatus(STATUS_KEY, `${emoji} ${event.level}`);
  });

  // ── Autocomplete Provider for /reasoning + SPACE ────────────
  //
  // Wraps the existing provider and intercepts ONLY when the user
  // types "/reasoning " (with trailing space). For everything else,
  // delegates to the wrapped provider unchanged.
  //
  // This guarantees /reasoning+SPACE shows the EXACT same options
  // as /reasoning+ENTER (both use buildReasoningMenuOptions).

  function createReasoningAutocompleteProvider(
    current: AutocompleteProvider,
  ): AutocompleteProvider {
    return {
      triggerCharacters: current.triggerCharacters,

      async getSuggestions(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: { signal: AbortSignal; force?: boolean },
      ): Promise<AutocompleteSuggestions | null> {
        const currentLine = lines[cursorLine] ?? "";
        const textBeforeCursor = currentLine.slice(0, cursorCol);

        // Intercept ONLY "/reasoning " followed by optional prefix
        const match = textBeforeCursor.match(/^\/reasoning\s+(.*)$/);
        if (match) {
          const userPrefix = match[1] ?? "";
          const menuOptions = buildReasoningMenuOptions(currentModel);
          const typedOnlyCommands = [
            { value: "map", label: "map  — Show active model→level mappings" },
            { value: "reset", label: "reset  — Restore default model mappings" },
          ];
          const allOptions = [...menuOptions, ...typedOnlyCommands];

          const lowerPrefix = userPrefix.trim().toLowerCase();
          const filtered = lowerPrefix
            ? allOptions.filter((opt) => opt.value.startsWith(lowerPrefix))
            : menuOptions;

          if (filtered.length === 0) return null;

          return {
            prefix: userPrefix,
            items: filtered.map((opt) => ({
              value: opt.value,
              label: opt.label,
              description: currentModel
                ? `${currentModel.provider}/${currentModel.id}`
                : "current model",
            })),
          };
        }

        // Everything else → delegate to wrapped provider
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      },

      applyCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        item: AutocompleteItem,
        prefix: string,
      ) {
        // Delegate applyCompletion to the wrapped provider
        if (current.applyCompletion) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        }
        // Fallback: simple replacement
        const currentLine = lines[cursorLine] ?? "";
        const before = currentLine.slice(0, cursorCol - prefix.length);
        const after = currentLine.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = before + item.value + " " + after;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: before.length + item.value.length + 1,
        };
      },

      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        const currentLine = lines[cursorLine] ?? "";
        // Allow forced refreshes (for example Tab) for /reasoning too.
        if (currentLine.match(/^\/reasoning\s/)) {
          return true;
        }
        // Delegate to wrapped provider for everything else
        if (current.shouldTriggerFileCompletion) {
          return current.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
        }
        return true;
      },
    };
  }

  // ── /reasoning Command ──────────────────────────────────────
  //
  // Usage:
  //   /reasoning                              — interactive menu
  //   /reasoning off|minimal|low|medium|high|xhigh|max — set manually
  //   /reasoning auto                         — re-apply auto-reasoning
  //   /reasoning reset                        — restore default map
  //   /reasoning map                          — show active mappings

  pi.registerCommand("reasoning", {
    description:
      "Show or set the thinking/reasoning level for the current model. " +
      "Use a level name as argument, or press ENTER for an interactive menu.",
    getArgumentCompletions: (prefix: string) => {
      const normalizedPrefix = prefix.trim().toLowerCase();
      const menuOptions = buildReasoningMenuOptions(currentModel);
      const typedOnlyCommands = [
        { value: "map", label: "map  — Show active model→level mappings" },
        { value: "reset", label: "reset  — Restore default model mappings" },
      ];
      const options = normalizedPrefix
        ? [...menuOptions, ...typedOnlyCommands].filter((option) =>
            option.value.startsWith(normalizedPrefix))
        : menuOptions;

      return options.length > 0 ? options : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim().toLowerCase();

      // ── No args: interactive menu ──
      if (!trimmed) {
        const options = buildReasoningMenuOptions(ctx.model);
        const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";

        const choice = await ctx.ui.select(
          `🧠  Reasoning level — ${modelLabel}`,
          options.map((option) => option.label),
        );
        if (!choice) return;

        const selected = options.find((option) => option.label === choice)!;

        if (selected.value === "auto") {
          handleAuto(ctx);
        } else {
          const chosen = selected.value as ThinkingLevel;
          const applied = resolveThinkingLevel(chosen, getAvailableLevels(ctx.model));
          if (!applied) {
            ctx.ui.notify("No reasoning level is available for this model", "warning");
            return;
          }
          pi.setThinkingLevel(applied);
          ctx.ui.notify(formatReasoningLevelChange(chosen, applied), "info");
        }
        return;
      }

      // ── Auto ──
      if (trimmed === "auto" || trimmed === "automatic") {
        handleAuto(ctx);
        return;
      }

      // ── Reset ──
      if (trimmed === "reset") {
        modelMap = [...DEFAULT_MODEL_MAP];
        ctx.ui.notify("Model map reset to defaults", "info");
        return;
      }

      // ── Map ──
      if (trimmed === "map" || trimmed === "list") {
        const lines = modelMap.map(
          (e) =>
            `  ${e.pattern.padEnd(24)} → ${e.level.padEnd(8)}${e.providers ? ` [${e.providers.join(", ")}]` : ""}`,
        );
        ctx.ui.notify(
          `🗺️  Active mappings (${modelMap.length}):\n${lines.join("\n")}`,
          "info",
        );
        return;
      }

      // ── Set specific level ──
      const available = getAvailableLevels(ctx.model);
      if ((ALL_THINKING_LEVELS as readonly string[]).includes(trimmed)) {
        const requested = trimmed as ThinkingLevel;
        const applied = resolveThinkingLevel(requested, available);
        if (!applied) {
          ctx.ui.notify("No reasoning level is available for this model", "warning");
          return;
        }
        pi.setThinkingLevel(applied);
        ctx.ui.notify(formatReasoningLevelChange(requested, applied), "info");
        return;
      }

      ctx.ui.notify(
        `Invalid level: "${trimmed}". Available: ${available.join(", ")}, auto, reset, map`,
        "warning",
      );
    },
  });

  // ── Shared auto handler ─────────────────────────────────────

  function handleAuto(ctx: { model?: typeof currentModel; ui: { notify: (msg: string, type: string) => void } }): void {
    const model = ctx.model;
    if (!model) {
      ctx.ui.notify("No model currently selected", "warning");
      return;
    }
    if (!model?.reasoning) {
      ctx.ui.notify(`Model ${model.id} does not support reasoning`, "info");
      return;
    }

    const mapped = findLevelForModel(model.provider, model.id);
    const level = mapped ?? guessLevel(model.id);
    const safeLevel = resolveThinkingLevel(level, getAvailableLevels(model));
    if (!safeLevel) {
      ctx.ui.notify("No reasoning level is available for this model", "warning");
      return;
    }

    const emoji = LEVEL_EMOJI[safeLevel] ?? "🧠";
    const originEmoji = LEVEL_EMOJI[level] ?? "";
    const note = safeLevel !== level
      ? ` (rounded, your choice was ${originEmoji} ${level})`
      : "";
    pi.setThinkingLevel(safeLevel);
    ctx.ui.notify(
      `Auto-reasoning → ${emoji} ${safeLevel}${note} (${model.provider}/${model.id})`,
      "info",
    );
  }
}
