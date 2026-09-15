/**
 * pi-cursor - extension factory
 *
 * Registers a `cursor` provider in pi, backed by the official `@cursor/sdk`
 * and the user's own Cursor API key.
 *
 * Security posture (see DISCLOSURE for the full statement):
 *   - the API key comes from pi's credential store (`/login cursor`) or
 *     `CURSOR_API_KEY`, and is never persisted, echoed, or logged by us;
 *   - this extension issues no network requests of its own — every request is
 *     the Cursor SDK talking to Cursor's own backend;
 *   - `CURSOR_BACKEND_URL` is refused unless it resolves inside the allowlist,
 *     so a stray export cannot redirect the key to a third party.
 */

import { createProvider, type Model as PiModel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeApiKeySource, normalizeApiKey, readEnvApiKey, resolveCursorApiKey } from "./_api-key.ts";
import { checkBackendOverride, describeEgressSurface, formatEgressSurface } from "./_egress.ts";
import {
	discoverCursorCatalog,
	registerCatalog,
	toPiModel,
	type CursorModelMetadata,
} from "./_models.ts";
import { maskApiKey } from "./_scrub.ts";
import { releaseAllAgentSessions } from "./_session.ts";
import { streamCursor } from "./_stream.ts";
import {
	CURSOR_API_ID,
	CURSOR_API_KEY_PLACEHOLDER,
	CURSOR_EGRESS_LOG_ENV,
	CURSOR_PROVIDER_ID,
	CURSOR_PROVIDER_NAME,
} from "./_types.ts";

/** Display/authority URL for the provider. A Cursor-owned host, like the rest. */
const CURSOR_BASE_URL = "https://api.cursor.com";

function buildProvider(metadata: CursorModelMetadata[]) {
	const models = metadata.map((entry) =>
		toPiModel(entry, { providerId: CURSOR_PROVIDER_ID, api: CURSOR_API_ID, baseUrl: CURSOR_BASE_URL }),
	);

	return createProvider({
		id: CURSOR_PROVIDER_ID,
		name: CURSOR_PROVIDER_NAME,
		baseUrl: CURSOR_BASE_URL,
		auth: {
			apiKey: {
				name: "Cursor API key",
				async login(interaction) {
					const raw = await interaction.prompt({
						type: "secret",
						message: "Cursor API key (stored locally in pi's auth.json, never sent anywhere but Cursor)",
					});
					const key = normalizeApiKey(raw);
					if (!key) throw new Error("No API key entered.");
					return { type: "api_key", key };
				},
				async resolve({ credential }) {
					// Fail closed: a redirected backend must never receive the key.
					const override = checkBackendOverride();
					if (!override.ok) return undefined;
					const key = normalizeApiKey(credential?.key) ?? readEnvApiKey();
					if (key) {
						return {
							auth: { apiKey: key },
							source: normalizeApiKey(credential?.key) ? "stored API key" : "CURSOR_API_KEY",
						};
					}
					// Nothing configured yet. Hand pi the non-secret placeholder so the
					// Cursor models stay visible in the picker before `/login`; the stream
					// path rejects the placeholder before any request is issued.
					return { auth: { apiKey: CURSOR_API_KEY_PLACEHOLDER }, source: "no Cursor API key configured yet" };
				},
			},
		},
		models,
		api: {
			stream: (model, context, options) => streamCursor(model, context, options),
			streamSimple: (model, context, options) => streamCursor(model, context, options),
		},
		fetchModels: async (context) => {
			const key = normalizeApiKey(context.credential?.type === "api_key" ? context.credential.key : undefined);
			const result = await discoverCursorCatalog({
				...(key ? { apiKey: key } : {}),
				forceRefresh: true,
			});
			return result.metadata.map((entry) =>
				toPiModel(entry, { providerId: CURSOR_PROVIDER_ID, api: CURSOR_API_ID, baseUrl: CURSOR_BASE_URL }),
			) as unknown as readonly PiModel<never>[];
		},
	});
}

function registerCursorProvider(pi: ExtensionAPI, metadata: CursorModelMetadata[]): void {
	pi.registerProvider(buildProvider(metadata));
}

export default async function (pi: ExtensionAPI): Promise<void> {
	const override = checkBackendOverride();

	const apiKey = override.ok ? await resolveCursorApiKey() : undefined;
	const discovery = await discoverCursorCatalog({ ...(apiKey ? { apiKey } : {}) });

	registerCursorProvider(pi, discovery.metadata);

	pi.registerCommand("cursor-models", {
		description: "Refresh the live Cursor model catalog without restarting pi",
		handler: async (_args, ctx) => {
			const blocking = checkBackendOverride();
			if (!blocking.ok) {
				if (ctx.hasUI) ctx.ui.notify(blocking.reason ?? "Cursor backend override blocked.", "error");
				return;
			}
			const refreshed = await discoverCursorCatalog({ apiKey, forceRefresh: true });
			registerCursorProvider(pi, refreshed.metadata);
			if (!ctx.hasUI) return;
			const count = refreshed.metadata.length;
			const label = `${count} model${count === 1 ? "" : "s"}`;
			if (refreshed.source === "live") ctx.ui.notify(`Cursor model catalog refreshed with ${label}.`, "info");
			else ctx.ui.notify(`Cursor catalog ${refreshed.source}: ${refreshed.note ?? "no live catalog"}`, "warning");
		},
	});

	pi.registerCommand("cursor-egress", {
		description: "Show pi-cursor's audited outbound surface",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(formatEgressSurface(describeEgressSurface()), "info");
		},
	});

	pi.registerCommand("cursor-key", {
		description: "Show which Cursor API key source is active (never prints the key)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const resolved = await resolveCursorApiKey();
			const source = await describeApiKeySource();
			ctx.ui.notify(
				resolved
					? `Cursor API key source: ${source} (${maskApiKey(resolved)})`
					: "No Cursor API key configured. Run /login cursor or set CURSOR_API_KEY.",
				resolved ? "info" : "warning",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await releaseAllAgentSessions();
	});

	if (process.env[CURSOR_EGRESS_LOG_ENV] === "1") {
		process.stderr.write(`${formatEgressSurface(describeEgressSurface())}\n`);
	}

	// Surface a blocked backend override immediately: silently degrading to
	// "not configured" would look like a broken key.
	if (!override.ok) {
		process.stderr.write(
			`pi-cursor: ${override.reason}\n` +
				"pi-cursor: Cursor models are registered but every request will fail until this is resolved.\n",
		);
	}

	if (discovery.note) {
		process.stderr.write(`pi-cursor: ${discovery.note}\n`);
	}
}

/** Exported for tests: rebuild the provider from a raw catalog. */
export function __buildProviderForTests(items: Parameters<typeof registerCatalog>[0]) {
	return buildProvider(registerCatalog(items));
}
