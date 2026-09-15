/**
 * pi-path-picker - inter-extension provider contract (private module)
 *
 * `ctx.ui.addAutocompleteProvider()` only reaches pi's *main* prompt editor.
 * An extension that renders its own editor never sees it, so it cannot offer
 * path completion - even though its editor is exactly where a user types a
 * path. That is the case for pi-ask's `ask` and `interview` UIs, which build
 * their own `Editor` from pi-tui.
 *
 * This contract lets any extension borrow the path provider at runtime, with no
 * package dependency and no import of another package's sources:
 *
 *   channel: "pi-path-picker:provider"
 *   payload: { cwd: string; reply: (provider: AutocompleteProvider) => void }
 *
 * `pi.events` is backed by a Node `EventEmitter`, so `emit` runs its listeners
 * synchronously and `reply` is called before the consumer's `emit` returns.
 * The consumer can therefore attach the provider in the same tick, without a
 * promise, a timeout, or a load-order handshake.
 *
 * If pi-path-picker is not installed, nobody answers: `reply` is never called
 * and the consumer keeps whatever it had (nothing). Degrading to "no path
 * completion" is the correct failure mode - it never breaks the host editor.
 *
 * The completion rule itself is unchanged and is enforced by the provider this
 * module hands out: `./`, `~/` or `/` inside a quote region (`"`, `'`, `` ` ``)
 * plus Tab. Nothing else opens the menu.
 */

import type { AutocompleteProvider } from '@earendil-works/pi-tui';

/** Channel name. Duplicated literally in pi-ask's consumer module; both sides
 *  assert the literal in their own tests so a rename cannot drift silently. */
export const PATH_PICKER_PROVIDER_CHANNEL = 'pi-path-picker:provider';

/** Request payload sent by a consumer over the channel. */
export interface PathPickerProviderRequest {
  /** Working directory the returned provider resolves relative paths against. */
  cwd: string;
  /** Called synchronously with the provider, or never when unavailable. */
  reply: (provider: AutocompleteProvider) => void;
}

/**
 * Stand-in for the wrapped provider when the host editor has none.
 *
 * pi's main prompt wraps a rich native provider; a custom editor usually has
 * nothing installed. The path provider delegates to `current` whenever it does
 * not own the context, so an inert delegate is what keeps that path harmless:
 * it answers "no suggestions" instead of forcing the host to special-case it.
 *
 * No `triggerCharacters` on purpose - the path picker is Tab-only, and the
 * editor falls back to its own defaults (`@`, `#`) which resolve to this
 * delegate and therefore to no menu.
 */
export const NULL_AUTOCOMPLETE_PROVIDER: AutocompleteProvider = {
  triggerCharacters: [],
  async getSuggestions() {
    return null;
  },
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
    // Applying a foreign completion must be a no-op, not a crash.
    return { lines, cursorLine, cursorCol };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a request payload and, when it is well-formed, hand the caller a
 * provider built for the requested `cwd`.
 *
 * Malformed payloads are ignored rather than thrown: these cross an extension
 * boundary, and one extension must never be able to break another by emitting
 * a bad event.
 */
export function answerProviderRequest(data: unknown, createProvider: (cwd: string) => AutocompleteProvider): boolean {
  if (!isRecord(data)) {
    return false;
  }

  const { cwd, reply } = data as Partial<PathPickerProviderRequest>;

  if (typeof cwd !== 'string' || cwd.trim() === '') {
    return false;
  }

  if (typeof reply !== 'function') {
    return false;
  }

  try {
    reply(createProvider(cwd));
  } catch {
    return false;
  }

  return true;
}

/**
 * Reference implementation of the consumer side, used by this package's tests
 * to prove the round trip. pi-ask re-implements the same two lines against the
 * same literal channel, because it must not import this package.
 */
export function requestProviderOverBus(
  bus: { emit(channel: string, data: unknown): void },
  cwd: string
): { provider?: AutocompleteProvider; answered: boolean } {
  let provider: AutocompleteProvider | undefined;

  bus.emit(PATH_PICKER_PROVIDER_CHANNEL, {
    cwd,
    reply: (value: AutocompleteProvider) => {
      provider = value;
    },
  } satisfies PathPickerProviderRequest);

  return { ...(provider ? { provider } : {}), answered: provider !== undefined };
}
