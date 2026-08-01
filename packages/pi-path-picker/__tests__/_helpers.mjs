/**
 * pi-path-picker — shared test helpers (private, underscore prefix)
 */

import assert from "node:assert/strict";
import pathPickerExtension from "../index.ts";
import { createMockPi, createMockCtx } from "../../../test/harness.mjs";

export function createProvider(cwd = "/tmp", nativeShouldTrigger = true) {
  const { pi, emit } = createMockPi();
  pathPickerExtension(pi);

  let registered = null;
  const captureCtx = createMockCtx({ cwd });
  captureCtx.ui.addAutocompleteProvider = (factory) => { registered = factory; };
  return (async () => {
    await emit("session_start", {}, captureCtx);
    assert.ok(registered, "must register an autocomplete provider on session_start");

    const calls = [];
    const current = {
      triggerCharacters: ["$"],
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        calls.push(["getSuggestions", lines, cursorLine, cursorCol, options]);
        return { prefix: lines[cursorLine].slice(0, cursorCol), items: [{ value: "model", label: "model" }] };
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        calls.push(["applyCompletion", lines, cursorLine, cursorCol, item, prefix]);
        return { lines: ["/model "], cursorLine: 0, cursorCol: 7 };
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        calls.push(["shouldTriggerFileCompletion", lines, cursorLine, cursorCol]);
        return nativeShouldTrigger;
      },
    };
    return { provider: registered(current), calls };
  })();
}
