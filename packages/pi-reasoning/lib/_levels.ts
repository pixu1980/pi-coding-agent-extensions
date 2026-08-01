/**
 * pi-reasoning — thinking level resolution helpers (private module)
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

export function formatReasoningLevelChange(requested: ThinkingLevel, applied: ThinkingLevel): string {
  const rounded = requested === applied
    ? ""
    : ` (rounded, your choice was ${LEVEL_EMOJI[requested]} ${requested})`;
  return `Reasoning level → ${LEVEL_EMOJI[applied]} ${applied}${rounded}`;
}
