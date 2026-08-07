/**
 * pi-path-picker - extension entry (factory)
 *
 * Registers the path autocomplete provider on session start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { createPathAutocompleteProvider } from "./_provider.ts";

export default function pathPickerExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider(
      (current: AutocompleteProvider) => createPathAutocompleteProvider(current, ctx.cwd),
    );
  });
}
