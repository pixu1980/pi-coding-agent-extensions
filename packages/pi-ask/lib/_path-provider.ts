/**
 * pi-ask - path completion bridge (private module)
 *
 * The `ask` and `interview` UIs render their own pi-tui `Editor` inside
 * `ctx.ui.custom()`. pi's autocomplete chain only reaches the *main* prompt
 * editor, so a custom editor starts with no completion at all - including no
 * path completion, even though "type the path here" is exactly what these
 * fields are for.
 *
 * `@pixu1980/pi-path-picker` publishes its provider over `pi.events` (a Node
 * `EventEmitter`, so `emit` is synchronous). This module is the consumer half
 * of that contract:
 *
 *     channel: "pi-path-picker:provider"
 *     payload: { cwd: string; reply: (provider) => void }
 *
 * When pi-path-picker is not installed nobody answers `reply`, the editor keeps
 * its own provider-less behavior. Nothing here can
 * break the host UI, and the completion rule stays owned by pi-path-picker:
 * `./`, `~/` or `/` inside `"`, `'` or `` ` `` plus Tab.
 *
 * The channel literal is duplicated from the producer on purpose - pi-ask does
 * not depend on that package. Both sides assert the literal in their own tests,
 * so a rename on one side fails a suite instead of silently disabling paths.
 */

/** Must match `PATH_PICKER_PROVIDER_CHANNEL` in @pixu1980/pi-path-picker. */
export const PATH_PICKER_PROVIDER_CHANNEL = 'pi-path-picker:provider';

/** Minimal slice of pi we need: only the inter-extension event bus. */
export interface PathProviderBus {
  events: { emit(channel: string, data: unknown): void };
}

/** The editor surface we attach to; pi-tui's `Editor` satisfies it. */
export interface AutocompleteHost {
  setAutocompleteProvider?(provider: unknown): void;
  isShowingAutocomplete?(): boolean;
}

/**
 * Ask pi-path-picker for a provider bound to `cwd`.
 *
 * Returns `undefined` when the package is absent or answers nothing, which the
 * caller treats as "no completion" rather than an error.
 */
export function resolvePathAutocompleteProvider(bus: PathProviderBus | undefined, cwd: string): unknown | undefined {
  if (!bus?.events || typeof bus.events.emit !== 'function') {
    return undefined;
  }

  let provider: unknown;

  try {
    bus.events.emit(PATH_PICKER_PROVIDER_CHANNEL, {
      cwd,
      reply: (value: unknown) => {
        provider = value;
      },
    });
  } catch {
    // A misbehaving listener must never take the interview UI down with it.
    return undefined;
  }

  return provider;
}

/**
 * Install path completion on a custom editor. Returns whether a provider was
 * attached, so tests can assert the wiring instead of the side effect.
 */
export function attachPathAutocomplete(
  editor: AutocompleteHost | undefined,
  bus: PathProviderBus | undefined,
  cwd: string
): boolean {
  if (!editor || typeof editor.setAutocompleteProvider !== 'function') {
    return false;
  }

  const provider = resolvePathAutocompleteProvider(bus, cwd);

  if (!provider) {
    return false;
  }

  editor.setAutocompleteProvider(provider);

  return true;
}

/**
 * Whether the caller must rebuild its rendered lines instead of serving a
 * cached frame.
 *
 * A custom component caches its lines and only clears them on its own key
 * handling. Autocomplete suggestions arrive asynchronously, after that key has
 * already been handled, and the `Editor` reports the new state by calling
 * `tui.requestRender()` - which re-renders children without invalidating them.
 * Without this check the menu would exist but never be painted.
 */
export function mustRebuildForAutocomplete(editor: AutocompleteHost | undefined): boolean {
  return editor?.isShowingAutocomplete?.() === true;
}
