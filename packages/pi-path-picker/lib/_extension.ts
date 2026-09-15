/**
 * pi-path-picker - extension entry (factory)
 *
 * Two registrations, two surfaces:
 *
 *   1. `ctx.ui.addAutocompleteProvider` reaches pi's main prompt editor.
 *   2. The `pi.events` channel answers extensions that render their own editor
 *      (pi-ask's `ask` / `interview` UI), which never see registration 1.
 *
 * Both hand out the same provider, so the completion rule - `./`, `~/` or `/`
 * inside a quote region plus Tab - is identical everywhere a path is typed.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AutocompleteProvider } from '@earendil-works/pi-tui';
import { answerProviderRequest, NULL_AUTOCOMPLETE_PROVIDER, PATH_PICKER_PROVIDER_CHANNEL } from './_contract.ts';
import { createPathAutocompleteProvider } from './_provider.ts';

export default function pathPickerExtension(pi: ExtensionAPI) {
  // Registered in the factory, not on session_start: a consumer may ask as soon
  // as its tool runs, and the factory runs before any tool can.
  pi.events.on(PATH_PICKER_PROVIDER_CHANNEL, (data) => {
    answerProviderRequest(data, (cwd) => createPathAutocompleteProvider(NULL_AUTOCOMPLETE_PROVIDER, cwd));
  });

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current: AutocompleteProvider) => createPathAutocompleteProvider(current, ctx.cwd));
  });
}
