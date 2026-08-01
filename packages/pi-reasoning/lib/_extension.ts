/**
 * pi-reasoning — extension entry (factory)
 *
 * Automatic reasoning level management for pi.dev: sets the thinking level
 * based on the selected model, exposes the /reasoning command, a status
 * indicator and the /reasoning autocomplete provider.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  DEFAULT_MODEL_MAP,
  ALL_THINKING_LEVELS,
  LEVEL_EMOJI,
  STATUS_KEY,
} from "./_constants.ts";
import type { ThinkingLevel, ModelMapEntry, ReasoningModelCapabilities } from "./_constants.ts";
import {
  getAvailableLevels,
  buildReasoningMenuOptions,
  resolveThinkingLevel,
  formatReasoningLevelChange,
} from "./_levels.ts";
import { createReasoningAutocompleteProvider } from "./_autocomplete.ts";

type ActiveModel = ReasoningModelCapabilities & { provider: string; id: string };

export default function (pi: ExtensionAPI): void {
  let modelMap: ModelMapEntry[] = [...DEFAULT_MODEL_MAP];

  let currentModel: ActiveModel | undefined;

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
      (current: AutocompleteProvider) => createReasoningAutocompleteProvider(current, () => currentModel),
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

  function handleAuto(ctx: { model?: typeof currentModel; ui: { notify: (msg: string, type?: "error" | "info" | "warning") => void } }): void {
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
