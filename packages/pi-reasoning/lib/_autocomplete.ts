/**
 * pi-reasoning - /reasoning autocomplete provider wrapper (private module)
 *
 * Intercepts ONLY "/reasoning " (with trailing space). Everything else is
 * delegated to the wrapped provider unchanged.
 */

import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { buildReasoningMenuOptions } from "./_levels.ts";
import type { ReasoningModelCapabilities } from "./_constants.ts";

export type ReasoningModelRef = ReasoningModelCapabilities & { provider?: string; id?: string };

const TYPED_ONLY_COMMANDS = [
  { value: "map", label: "map  - Show active model→level mappings" },
  { value: "reset", label: "reset  - Restore default model mappings" },
];

export function createReasoningAutocompleteProvider(
  current: AutocompleteProvider,
  getCurrentModel: () => ReasoningModelRef | undefined,
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
        const menuOptions = buildReasoningMenuOptions(getCurrentModel());
        const allOptions = [...menuOptions, ...TYPED_ONLY_COMMANDS];

        const lowerPrefix = userPrefix.trim().toLowerCase();
        const filtered = lowerPrefix
          ? allOptions.filter((opt) => opt.value.startsWith(lowerPrefix))
          : menuOptions;

        if (filtered.length === 0) return null;

        const currentModel = getCurrentModel();
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
