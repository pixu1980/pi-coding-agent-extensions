/**
 * pi-cursor - extension factory
 *
 * Registers a `cursor` provider in pi, backed by the official `@cursor/sdk`
 * and the user's own Cursor API key.
 *
 * Security posture (see DISCLOSURE for the full statement):
 *   - the API key comes from pi's credential store (`/login cursor`) or
 *     `CURSOR_API_KEY`, and is never persisted, echoed, or logged by us;
 *   - this extension issues no network requests of its own: every request is
 *     the Cursor SDK talking to Cursor's own backend;
 *   - `CURSOR_BACKEND_URL` is refused unless it resolves inside the allowlist,
 *     so a stray export cannot redirect the key to a third party.
 */

import { createProvider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describeApiKeySource, normalizeApiKey, readEnvApiKey, resolveCursorApiKey } from './_api-key.ts';
import { checkBackendOverride, describeEgressSurface, formatEgressSurface } from './_egress.ts';
import {
  applyLocalModelCatalogEnv,
  discoverCursorCatalog,
  isOfflineMode,
  registerCatalog,
  toPiModel,
  type CursorModelMetadata,
} from './_models.ts';
import { maskApiKey } from './_scrub.ts';
import { releaseAllAgentSessions } from './_session.ts';
import { streamCursor } from './_stream.ts';
import {
  CURSOR_API_ID,
  CURSOR_API_KEY_PLACEHOLDER,
  CURSOR_EGRESS_LOG_ENV,
  CURSOR_PROVIDER_ID,
  CURSOR_PROVIDER_NAME,
} from './_types.ts';

/** Display/authority URL for the provider. A Cursor-owned host, like the rest. */
const CURSOR_BASE_URL = 'https://api.cursor.com';

/**
 * Build the pi provider around a resolved Cursor catalog.
 *
 * @param metadata - Registered Cursor models.
 * @returns The `cursor` provider, ready for registration.
 */
function buildProvider(metadata: CursorModelMetadata[]) {
  const models = metadata.map((entry) =>
    toPiModel(entry, { providerId: CURSOR_PROVIDER_ID, api: CURSOR_API_ID, baseUrl: CURSOR_BASE_URL })
  );

  return createProvider({
    id: CURSOR_PROVIDER_ID,
    name: CURSOR_PROVIDER_NAME,
    baseUrl: CURSOR_BASE_URL,
    auth: {
      apiKey: {
        name: 'Cursor API key',
        async login(interaction) {
          const raw = await interaction.prompt({
            type: 'secret',
            message: "Cursor API key (stored locally in pi's auth.json, never sent anywhere but Cursor)",
          });

          const key = normalizeApiKey(raw);

          if (!key) {
            throw new Error('No API key entered.');
          }

          return { type: 'api_key', key };
        },
        async resolve({ credential }) {
          // Fail closed: a redirected backend must never receive the key.
          const override = checkBackendOverride();

          if (!override.ok) {
            return undefined;
          }

          const key = normalizeApiKey(credential?.key) ?? readEnvApiKey();

          if (key) {
            return {
              auth: { apiKey: key },
              source: normalizeApiKey(credential?.key) ? 'stored API key' : 'CURSOR_API_KEY',
            };
          }

          // Nothing configured yet. Hand pi the non-secret placeholder so the
          // Cursor models stay visible in the picker before `/login`; the stream
          // path rejects the placeholder before any request is issued.
          return { auth: { apiKey: CURSOR_API_KEY_PLACEHOLDER }, source: 'no Cursor API key configured yet' };
        },
      },
    },
    models,
    api: {
      stream: (model, context, options) => streamCursor(model, context, options),
      streamSimple: (model, context, options) => streamCursor(model, context, options),
    },
    fetchModels: async (context) => {
      const key = normalizeApiKey(context.credential?.type === 'api_key' ? context.credential.key : undefined);
      // No forceRefresh: the 6h disk cache plus the in-memory memo serve
      // repeated calls. Explicit refresh lives in /cursor-models.
      const result = await discoverCursorCatalog({
        ...(key ? { apiKey: key } : {}),
      });

      return result.metadata.map((entry) =>
        toPiModel(entry, { providerId: CURSOR_PROVIDER_ID, api: CURSOR_API_ID, baseUrl: CURSOR_BASE_URL })
      );
    },
  });
}

/**
 * Register the built provider with pi.
 *
 * @param pi - The extension API.
 * @param metadata - Registered Cursor models.
 */
function registerCursorProvider(pi: ExtensionAPI, metadata: CursorModelMetadata[]): void {
  pi.registerProvider(buildProvider(metadata));
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const override = checkBackendOverride();

  const apiKey = override.ok ? await resolveCursorApiKey() : undefined;
  const discovery = await discoverCursorCatalog({ ...(apiKey ? { apiKey } : {}) });

  registerCursorProvider(pi, discovery.metadata);

  // The SDK validates a local agent's model against the Cloud Agent catalog and
  // treats a validation failure as fatal. That endpoint answers
  // `403 [plan_required]` on a Free plan, which would block every local run, so
  // publish the catalog we just resolved and keep the validation in-process.
  applyLocalModelCatalogEnv();

  pi.registerCommand('cursor-models', {
    description: 'Refresh the live Cursor model catalog without restarting pi',
    handler: async (_args, ctx) => {
      const blocking = checkBackendOverride();

      if (!blocking.ok) {
        if (ctx.hasUI) {
          ctx.ui.notify(blocking.reason ?? 'Cursor backend override blocked.', 'error');
        }

        return;
      }

      if (isOfflineMode()) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            'pi is running offline; refreshing the Cursor catalog would send your API key. Restart without --offline.',
            'warning'
          );
        }

        return;
      }

      const refreshed = await discoverCursorCatalog({ apiKey, forceRefresh: true });

      registerCursorProvider(pi, refreshed.metadata);
      applyLocalModelCatalogEnv();

      if (!ctx.hasUI) {
        return;
      }

      const count = refreshed.metadata.length;
      const label = `${count} model${count === 1 ? '' : 's'}`;

      if (refreshed.source === 'live') {
        ctx.ui.notify(`Cursor model catalog refreshed with ${label}.`, 'info');
      } else {
        ctx.ui.notify(`Cursor catalog ${refreshed.source}: ${refreshed.note ?? 'no live catalog'}`, 'warning');
      }
    },
  });

  pi.registerCommand('cursor-egress', {
    description: "Show pi-cursor's audited outbound surface",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      ctx.ui.notify(formatEgressSurface(describeEgressSurface()), 'info');
    },
  });

  pi.registerCommand('cursor-key', {
    description: 'Show which Cursor API key source is active (never prints the key)',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const resolved = await resolveCursorApiKey();
      const source = await describeApiKeySource();

      ctx.ui.notify(
        resolved
          ? `Cursor API key source: ${source} (${maskApiKey(resolved)})`
          : 'No Cursor API key configured. Run /login cursor or set CURSOR_API_KEY.',
        resolved ? 'info' : 'warning'
      );
    },
  });

  pi.on('session_shutdown', async () => {
    await releaseAllAgentSessions();
  });

  if (process.env[CURSOR_EGRESS_LOG_ENV] === '1') {
    process.stderr.write(`${formatEgressSurface(describeEgressSurface())}\n`);
  }

  // Surface a blocked backend override immediately: silently degrading to
  // "not configured" would look like a broken key.
  if (!override.ok) {
    process.stderr.write(
      `pi-cursor: ${override.reason}\n` +
        'pi-cursor: Cursor models are registered but every request will fail until this is resolved.\n'
    );
  }

  // A Free plan cannot read the Cloud Agent catalog, and the local catalog
  // covers it. That is a plan limitation, not a fault, so it stays off the
  // startup banner and shows up only on an explicit `/cursor-models` refresh.
  if (discovery.note && !discovery.quiet) {
    process.stderr.write(`pi-cursor: ${discovery.note}\n`);
  }
}

/**
 * Rebuild the provider from a raw catalog, for tests.
 *
 * @param items - Raw Cursor catalog entries.
 * @returns The `cursor` provider.
 */
export function __buildProviderForTests(items: Parameters<typeof registerCatalog>[0]) {
  return buildProvider(registerCatalog(items));
}
