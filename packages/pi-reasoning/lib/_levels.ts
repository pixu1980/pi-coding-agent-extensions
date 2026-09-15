/**
 * pi-reasoning - thinking level resolution helpers (private module)
 */

import {
  ALL_THINKING_LEVELS,
  STANDARD_THINKING_LEVELS,
  LEVEL_EMOJI,
} from "./_constants.ts";
import type { ThinkingLevel, ReasoningModelCapabilities } from "./_constants.ts";

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
  if (!model?.reasoning) {
    return ["off"];
  }

  return ALL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];

    if (mapped === null) {
      return false;
    }

    if (mapped !== undefined) {
      return true;
    }

    return STANDARD_THINKING_LEVELS.includes(level);
  });
}

/**
 * Canonical emoji-prefixed render: one emoji, two spaces, then the text.
 *
 * Generic helper for non-level strings (provider/model labels, `auto`,
 * section titles). Thinking-level labels go through formatLevelLabel,
 * which compensates the separator per level so the visual gap looks the
 * same everywhere.
 *
 * Every emoji-labeled string goes through these two helpers, so a level's
 * separator cannot differ between the menu and the notification.
 */
export function formatEmojiText(emoji: string, text: string): string {
  return `${emoji}  ${text}`;
}

/**
 * Levels rendered with a single space after the emoji: `off`, `minimal`,
 * `low`, `medium` and `max`. `high` and `xhigh` keep two spaces. This is
 * the requested rendering (see README): the set is the single source of
 * truth, every surface derives its separator from it. Add a level here to
 * switch it to one space.
 */
export const SINGLE_SPACE_LEVELS: ReadonlySet<ThinkingLevel> = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "max",
]);

/**
 * Canonical "emoji + level" render: `❤️  high`, `❤️‍🔥  xhigh`, `🔥 max`.
 * Every surface (menu, autocomplete, status bar, notifications) uses this,
 * so a level looks identical wherever it appears.
 */
export function formatLevelLabel(level: ThinkingLevel): string {
  const sep = SINGLE_SPACE_LEVELS.has(level) ? " " : "  ";

  return `${LEVEL_EMOJI[level] ?? "🧠"}${sep}${level}`;
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
      label: formatLevelLabel(level),
    })),
    { value: "auto" as const, label: formatEmojiText("⚙️", "auto") },
  ];
}

/** Resolve an unsupported request to a supported thinking level. */
export function resolveThinkingLevel(
  requested: ThinkingLevel,
  available: readonly ThinkingLevel[],
): ThinkingLevel | undefined {
  if (available.length === 0) {
    return undefined;
  }

  if (available.includes(requested)) {
    return requested;
  }

  const requestedIndex = ALL_THINKING_LEVELS.indexOf(requested);

  return available.find((level) => ALL_THINKING_LEVELS.indexOf(level) > requestedIndex)
    ?? available[available.length - 1];
}

export function formatReasoningLevelChange(requested: ThinkingLevel, applied: ThinkingLevel): string {
  const rounded = requested === applied
    ? ""
    : ` (rounded, your choice was ${formatLevelLabel(requested)})`;

  return `Reasoning level → ${formatLevelLabel(applied)}${rounded}`;
}
