/**
 * pi-lyceum - extension factory
 *
 * Registers a `lyceum` provider in pi for Lyceum's OpenAI-compatible serverless
 * inference API, authenticated with the user's own Lyceum API key.
 *
 * Design notes:
 *   - chat traffic is not implemented here. Every model points at pi's
 *     `openai-completions` API, so message conversion, tool calls, streaming,
 *     cancellation and usage accounting are the host's, not ours;
 *   - the bundled catalog gives a working, priced model list offline. The live
 *     `GET /models` list is an overlay: known ids keep the bundled metadata,
 *     unknown ids are added with documented conservative defaults;
 *   - a discovery failure never empties the picker. It keeps the bundled
 *     catalog, and `/lyceum-models` reports the failure when the user asks for
 *     a refresh;
 *   - the key comes from `/login lyceum` only, and no message this extension
 *     prints can contain it.
 */

import {
  createProvider,
  type Api,
  type ApiKeyAuth,
  type Model,
  type Provider,
  type ProviderStreams,
} from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { normalizeApiKey, readStoredLyceumApiKey } from './_api-key.ts';
import { bundledModels, mergeLiveCatalog } from './_catalog.ts';
import { fetchLiveModelIds } from './_discovery.ts';
import { LYCEUM_BASE_URL, LYCEUM_PROVIDER_ID, LYCEUM_PROVIDER_NAME, LYCEUM_REFRESH_COMMAND } from './_types.ts';

/**
 * `/login lyceum` and every later request read the same stored credential.
 *
 * There is no environment fallback on purpose: the key has one source, so a
 * stray shell export cannot silently outrank what the user saved in pi.
 */
const LYCEUM_API_KEY_AUTH: ApiKeyAuth = {
  name: 'Lyceum API key',
  async login(interaction) {
    const raw = await interaction.prompt({
      type: 'secret',
      message: "Lyceum API key (stored locally in pi's auth.json, never sent anywhere but Lyceum)",
    });

    const key = normalizeApiKey(raw);

    if (!key) {
      throw new Error('No API key entered.');
    }

    return { type: 'api_key', key };
  },
  async resolve({ credential }) {
    const key = normalizeApiKey(credential?.key);

    if (!key) {
      return undefined;
    }

    return { auth: { apiKey: key }, source: 'stored API key' };
  },
};

/**
 * The host's implementation of the `openai-completions` API, as a factory.
 *
 * `createProvider` takes the stream implementation, so the extension needs the
 * value, not the API id.
 */
export type CompletionsApiFactory = () => ProviderStreams;

/**
 * Resolve the host's `openai-completions` implementation.
 *
 * The extension loader maps a fixed set of specifiers, and only the package
 * root is among them. A newer host exports the implementation there. An older
 * host exposes it only through the package subpath, which resolves in a
 * checkout that installs pi-ai itself, so it stays as a fallback.
 *
 * @returns The implementation factory the host provides.
 */
export async function resolveCompletionsApi(): Promise<CompletionsApiFactory> {
  try {
    const root = (await import('@earendil-works/pi-ai')) as unknown as Record<string, unknown>;
    const fromRoot = root.openAICompletionsApi;

    if (typeof fromRoot === 'function') {
      return fromRoot as CompletionsApiFactory;
    }
  } catch {
    // The root import failed; try the subpath below.
  }

  const subpath = (await import('@earendil-works/pi-ai/api/openai-completions.lazy')) as {
    openAICompletionsApi: CompletionsApiFactory;
  };

  return subpath.openAICompletionsApi;
}

/**
 * Build the pi provider around a model list.
 *
 * @param models - Models to register as the provider baseline.
 * @param apiFactory - The host's `openai-completions` implementation.
 * @returns The `lyceum` provider, ready for registration.
 */
export function buildLyceumProvider(models: readonly Model<Api>[], apiFactory: CompletionsApiFactory): Provider<Api> {
  return createProvider({
    id: LYCEUM_PROVIDER_ID,
    name: LYCEUM_PROVIDER_NAME,
    baseUrl: LYCEUM_BASE_URL,
    auth: { apiKey: LYCEUM_API_KEY_AUTH },
    models,
    api: apiFactory(),
    fetchModels: async (context) => {
      const key = normalizeApiKey(context.credential?.type === 'api_key' ? context.credential.key : undefined);

      if (!key) {
        return [];
      }

      try {
        const ids = await fetchLiveModelIds({ apiKey: key, signal: context.signal });

        return mergeLiveCatalog(ids);
      } catch {
        // Keep the bundled catalog rather than replacing it with nothing: a
        // refresh at startup must not empty the picker because the endpoint was
        // briefly unavailable. An explicit `/lyceum-models` surfaces the error.
        return [];
      }
    },
  });
}

/**
 * Human-readable failure text for the refresh command.
 *
 * @param error - Whatever the refresh threw.
 * @returns The message, without any stack or request detail.
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Install the extension: register the provider and the refresh command.
 *
 * @param pi - The extension API.
 */
export default async function (pi: ExtensionAPI): Promise<void> {
  const apiFactory = await resolveCompletionsApi();

  pi.registerProvider(buildLyceumProvider(bundledModels(), apiFactory));

  pi.registerCommand(LYCEUM_REFRESH_COMMAND, {
    description: 'Refresh the live Lyceum model catalog without restarting pi',
    handler: async (_args, ctx) => {
      const key = await readStoredLyceumApiKey();

      if (!key) {
        if (ctx.hasUI) {
          ctx.ui.notify('No Lyceum API key configured. Run /login lyceum first.', 'warning');
        }

        return;
      }

      try {
        const models = mergeLiveCatalog(await fetchLiveModelIds({ apiKey: key }));

        pi.registerProvider(buildLyceumProvider(models, apiFactory));

        if (ctx.hasUI) {
          ctx.ui.notify(
            `Lyceum model catalog refreshed with ${models.length} chat model${models.length === 1 ? '' : 's'}.`,
            'info'
          );
        }
      } catch (error) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Lyceum model catalog refresh failed: ${errorText(error)}`, 'error');
        }
      }
    },
  });
}
