/**
 * pi-cursor - Cursor agent turns mapped onto pi's stream protocol
 *
 * The Cursor SDK runs a *self-contained* agent: it owns its own shell, read,
 * edit and search tools and executes them locally. pi therefore must not be
 * handed `toolCall` blocks here — pi would try to execute them a second time.
 * Instead:
 *
 *   text-delta        -> pi text blocks (the actual answer)
 *   thinking-delta    -> pi thinking blocks (the model's reasoning)
 *   tool activity     -> display-only trace inside a thinking block
 *   turn-ended        -> usage + stop reason
 *
 * The tool trace is deliberately bounded and summarised (command, path, pattern)
 * rather than dumped: streaming whole file bodies into the transcript would copy
 * the user's source into the session log for no benefit.
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	Usage,
} from "@earendil-works/pi-ai";
import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { normalizeApiKey } from "./_api-key.ts";
import { checkBackendOverride } from "./_egress.ts";
import { buildModelSelection, getModelMetadata, type PiThinkingLevel } from "./_models.ts";
import { scrubError, scrubSecrets } from "./_scrub.ts";
import {
	disposeAgentHandle,
	getAgentSession,
	rememberAgentSession,
	sessionSlotId,
	type CursorAgentHandle,
	type CursorRunHandle,
	type CursorSdkLike,
} from "./_session.ts";
import { CURSOR_ACTIVITY_TRACE_MAX_CHARS, CURSOR_API_ID, CURSOR_PROVIDER_ID } from "./_types.ts";

// ── Usage ─────────────────────────────────────────────────────────────────

export interface CursorTokenUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
}

function nonNegative(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getUsageField(usage: unknown, key: keyof CursorTokenUsage): number | undefined {
	if (typeof usage !== "object" || usage === null) return undefined;
	return nonNegative((usage as Record<string, unknown>)[key]);
}

/** Fold a Cursor usage payload into pi's `Usage`, marking it unverified cost. */
export function toPiUsage(usage: unknown, existing: Usage): Usage {
	const input = getUsageField(usage, "inputTokens") ?? existing.input;
	const output = getUsageField(usage, "outputTokens") ?? existing.output;
	const cacheRead = getUsageField(usage, "cacheReadTokens") ?? existing.cacheRead;
	const cacheWrite = getUsageField(usage, "cacheWriteTokens") ?? existing.cacheWrite;
	const reasoning = getUsageField(usage, "reasoningTokens");
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		...(reasoning === undefined ? {} : { reasoning }),
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: existing.cost,
	};
}

// ── Content emitter ───────────────────────────────────────────────────────

/**
 * Owns the pi stream's content blocks while a Cursor turn streams in.
 *
 * Text and thinking are mutually exclusive in the rendered transcript: a text
 * block is closed before thinking starts and vice versa, so the user never sees
 * a half-written answer interleaved with trace output.
 */
export class CursorContentEmitter {
	private textIndex = -1;
	private thinkingIndex = -1;
	private activityChars = 0;
	private activityTruncated = false;

	constructor(
		private readonly stream: AssistantMessageEventStream,
		private readonly partial: AssistantMessage,
		private readonly activityMaxChars = CURSOR_ACTIVITY_TRACE_MAX_CHARS,
	) {}

	get activityLength(): number {
		return this.activityChars;
	}

	get textLength(): number {
		let total = 0;
		for (const block of this.partial.content) if (block.type === "text") total += block.text.length;
		return total;
	}

	closeText(): void {
		if (this.textIndex < 0) return;
		const index = this.textIndex;
		this.textIndex = -1;
		const block = this.partial.content[index];
		if (block?.type !== "text") return;
		this.stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: this.partial });
	}

	closeThinking(): void {
		if (this.thinkingIndex < 0) return;
		const index = this.thinkingIndex;
		this.thinkingIndex = -1;
		const block = this.partial.content[index];
		if (block?.type !== "thinking") return;
		this.stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: this.partial });
	}

	closeAll(): void {
		this.closeText();
		this.closeThinking();
	}

	appendText(delta: string): void {
		if (!delta) return;
		this.closeThinking();
		if (this.textIndex < 0) {
			this.textIndex = this.partial.content.length;
			this.partial.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex: this.textIndex, partial: this.partial });
		}
		const block = this.partial.content[this.textIndex];
		if (block?.type !== "text") return;
		block.text += delta;
		this.stream.push({ type: "text_delta", contentIndex: this.textIndex, delta, partial: this.partial });
	}

	appendThinking(delta: string): void {
		if (!delta) return;
		this.closeText();
		if (this.thinkingIndex < 0) {
			this.thinkingIndex = this.partial.content.length;
			this.partial.content.push({ type: "thinking", thinking: "" });
			this.stream.push({ type: "thinking_start", contentIndex: this.thinkingIndex, partial: this.partial });
		}
		const block = this.partial.content[this.thinkingIndex];
		if (block?.type !== "thinking") return;
		block.thinking += delta;
		this.stream.push({ type: "thinking_delta", contentIndex: this.thinkingIndex, delta, partial: this.partial });
	}

	/** Bounded, display-only trace line (tool activity, shell output). */
	appendActivity(line: string): void {
		if (this.activityTruncated || !line) return;
		const normalized = line.endsWith("\n") ? line : `${line}\n`;
		const remaining = this.activityMaxChars - this.activityChars;
		if (remaining <= 0) {
			this.appendThinking("\n[Cursor activity trace truncated]\n");
			this.activityTruncated = true;
			return;
		}
		const text =
			normalized.length > remaining ? `${normalized.slice(0, remaining)}\n[Cursor activity trace truncated]\n` : normalized;
		if (normalized.length > remaining) this.activityTruncated = true;
		this.activityChars += text.length;
		this.appendThinking(text);
	}
}

// ── Delta routing ─────────────────────────────────────────────────────────

export interface CursorDeltaSink {
	text(delta: string): void;
	thinking(delta: string): void;
	activity(line: string): void;
	usage(usage: CursorTokenUsage): void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function shortString(value: unknown, max = 200): string | undefined {
	if (typeof value !== "string") return undefined;
	const single = value.replace(/\s+/g, " ").trim();
	if (!single) return undefined;
	return single.length > max ? `${single.slice(0, max)}…` : single;
}

/**
 * Summarise a Cursor tool call into one trace line.
 *
 * Only structural fields are read (command, path, pattern). File bodies and
 * tool results are never copied into the trace.
 */
export function describeCursorToolCall(toolCall: unknown): string | undefined {
	const call = asRecord(toolCall);
	if (!call) return undefined;
	const type = typeof call.type === "string" ? call.type : "tool";
	const args = asRecord(call.args) ?? {};
	const detail =
		shortString(args.command) ??
		shortString(args.path) ??
		shortString(args.pattern) ??
		shortString(args.query) ??
		shortString(args.glob);
	return detail ? `${type}: ${detail}` : type;
}

/**
 * Map one Cursor interaction update onto the sink.
 *
 * Unknown update types are ignored on purpose: the SDK adds update kinds over
 * time and an unrecognised delta must never break a turn.
 */
export function routeCursorDelta(update: unknown, sink: CursorDeltaSink): void {
	const record = asRecord(update);
	if (!record) return;
	const type = record.type;

	switch (type) {
		case "text-delta": {
			const text = typeof record.text === "string" ? record.text : "";
			if (text) sink.text(text);
			return;
		}
		case "thinking-delta": {
			const text = typeof record.text === "string" ? record.text : "";
			if (text) sink.thinking(text);
			return;
		}
		case "tool-call-started": {
			const label = describeCursorToolCall(record.toolCall);
			if (label) sink.activity(`▸ ${label}`);
			return;
		}
		case "tool-call-completed": {
			const label = describeCursorToolCall(record.toolCall);
			if (label) sink.activity(`✓ ${label}`);
			return;
		}
		case "partial-tool-call": {
			return;
		}
		case "shell-output-delta": {
			const event = asRecord(record.event);
			const data = shortString(event?.data ?? event?.text ?? event?.output, 400);
			if (data) sink.activity(`  ${data}`);
			return;
		}
		case "token-delta": {
			sink.usage({
				inputTokens: getUsageField(record.tokens, "inputTokens"),
				outputTokens: getUsageField(record.tokens, "outputTokens"),
				cacheReadTokens: getUsageField(record.tokens, "cacheReadTokens"),
				cacheWriteTokens: getUsageField(record.tokens, "cacheWriteTokens"),
				reasoningTokens: getUsageField(record.tokens, "reasoningTokens"),
			});
			return;
		}
		case "turn-ended": {
			sink.usage({
				inputTokens: getUsageField(record.usage, "inputTokens"),
				outputTokens: getUsageField(record.usage, "outputTokens"),
				cacheReadTokens: getUsageField(record.usage, "cacheReadTokens"),
				cacheWriteTokens: getUsageField(record.usage, "cacheWriteTokens"),
				reasoningTokens: getUsageField(record.usage, "reasoningTokens"),
			});
			return;
		}
		default:
			return;
	}
}

// ── Prompt rendering ──────────────────────────────────────────────────────

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const record = asRecord(block);
		if (!record) continue;
		if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
		if (record.type === "image") parts.push("[image omitted]");
	}
	return parts.join("\n");
}

/**
 * Render pi's conversation into a single prompt for the Cursor agent.
 *
 * On the *first* turn of a pi session the agent has no memory, so the whole
 * transcript is handed over once. On later turns only the newest user message
 * is sent: the agent already holds the earlier turns, and replaying them would
 * duplicate context on every turn.
 */
export function renderCursorPrompt(context: Context, options: { bootstrap: boolean }): string {
	const messages = context.messages ?? [];
	const latestUserIndex = (() => {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			if (messages[index]?.role === "user") return index;
		}
		return -1;
	})();

	const latestUser = latestUserIndex >= 0 ? contentToText(messages[latestUserIndex]?.content) : "";
	if (!options.bootstrap) return latestUser;

	const lines: string[] = [];
	const systemPrompt = context.systemPrompt?.trim();
	if (systemPrompt) lines.push(systemPrompt, "");
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (!message) continue;
		if (message.role === "user" && index === latestUserIndex) continue;
		const text = contentToText(message.content);
		if (!text.trim()) continue;
		lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
	}
	if (latestUser) {
		if (lines.length > 0) lines.push("");
		lines.push(latestUser);
	}
	return lines.join("\n");
}

// ── Turn planning ─────────────────────────────────────────────────────────

export interface CursorTurnPlan {
	prompt: string;
	selection: { id: string; params?: { id: string; value: string }[] };
	sessionSlot: string;
	/** True when the request will build a new agent and must replay history. */
	bootstrap: boolean;
}

export interface PlanCursorTurnOptions {
	sessionId?: string;
	thinkingLevel?: PiThinkingLevel;
	fast?: boolean;
	/** Whether a reusable agent already exists for this session+model. */
	hasLiveAgent: boolean;
}

/** Decide what to send for this turn. Pure: no SDK, no I/O. */
export function planCursorTurn(
	model: Model<Api>,
	context: Context,
	options: PlanCursorTurnOptions,
): CursorTurnPlan {
	const thinkingLevel = options.thinkingLevel ?? thinkingLevelFromModel(model);
	return {
		prompt: renderCursorPrompt(context, { bootstrap: !options.hasLiveAgent }),
		selection: buildModelSelection(model.id, thinkingLevel, options.fast),
		sessionSlot: sessionSlotId(options.sessionId),
		bootstrap: !options.hasLiveAgent,
	};
}

function thinkingLevelFromModel(model: Model<Api>): PiThinkingLevel {
	return model.reasoning ? "medium" : "off";
}

/** Map a terminal Cursor run status onto pi's stop reason. */
export function stopReasonForRunStatus(status: string | undefined): "stop" | "error" | "aborted" {
	if (status === "finished") return "stop";
	if (status === "cancelled") return "aborted";
	return "error";
}

// ── Stream entry point ────────────────────────────────────────────────────

export interface CursorStreamDependencies {
	loadSdk: () => Promise<CursorSdkLike>;
	now: () => number;
	cwd: () => string;
}

const defaultDependencies: CursorStreamDependencies = {
	loadSdk: async () => (await import("@cursor/sdk")) as unknown as CursorSdkLike,
	now: () => Date.now(),
	cwd: () => process.cwd(),
};

function emptyUsage(existing?: Usage): Usage {
	return (
		existing ?? {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		}
	);
}

/**
 * pi provider `streamSimple` implementation for every Cursor model.
 *
 * The returned stream always terminates: `done` on success, `error` on any
 * failure, with the API key scrubbed out of the error text.
 */
export function streamCursor(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
	dependencies: CursorStreamDependencies = defaultDependencies,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	// The placeholder pi receives before `/login` is not a key; normalising here
	// is what keeps it from ever reaching the SDK.
	const apiKey = normalizeApiKey(options?.apiKey);

	void (async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api ?? CURSOR_API_ID,
			provider: model.provider ?? CURSOR_PROVIDER_ID,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "pending",
			timestamp: dependencies.now(),
		};
		const emitter = new CursorContentEmitter(stream, output);
		let run: CursorRunHandle | undefined;

		try {
			stream.push({ type: "start", partial: output });

			const overrideCheck = checkBackendOverride();
			if (!overrideCheck.ok) throw new Error(overrideCheck.reason);

			if (!apiKey) {
				throw new Error(
					"No Cursor API key is configured. Run /login cursor in pi, or export CURSOR_API_KEY.",
				);
			}

			const metadata = getModelMetadata(model.id);
			const liveAgent = getAgentSession({
				sessionId: options?.sessionId ?? "default",
				selectionId: metadata?.selectionModelId ?? model.id,
			});
			const plan = planCursorTurn(model, context, {
				...(options?.sessionId ? { sessionId: options.sessionId } : {}),
				hasLiveAgent: liveAgent !== undefined,
			});

			if (!plan.prompt.trim()) {
				output.stopReason = "stop";
				emitter.closeAll();
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
				return;
			}

			const sdk = await dependencies.loadSdk();
			const agent =
				liveAgent ??
				(await sdk.Agent.create({
					apiKey,
					model: plan.selection,
					local: { cwd: dependencies.cwd() },
					name: `pi:${plan.sessionSlot}`,
				}));

			if (!liveAgent) {
				rememberAgentSession(
					{ sessionId: options?.sessionId ?? "default", selectionId: plan.selection.id },
					agent,
				);
			}

			run = await agent.send(plan.prompt, {
				model: plan.selection,
				onDelta: ({ update }: { update: unknown }) => {
					routeCursorDelta(update, {
						text: (delta) => emitter.appendText(scrubSecrets(delta, apiKey)),
						thinking: (delta) => emitter.appendThinking(scrubSecrets(delta, apiKey)),
						activity: (line) => emitter.appendActivity(scrubSecrets(line, apiKey)),
						usage: (usage) => {
							output.usage = toPiUsage(usage, output.usage);
						},
					});
				},
			});

			const abort = () => {
				void run?.cancel().catch(() => undefined);
			};
			options?.signal?.addEventListener("abort", abort, { once: true });

			const result = await run.wait();
			options?.signal?.removeEventListener("abort", abort);

			if (result.usage) output.usage = toPiUsage(result.usage, output.usage);
			if (typeof result.result === "string" && result.result.trim() && emitter.textLength === 0) {
				// Some runs deliver the answer only in the terminal result.
				emitter.appendText(scrubSecrets(result.result, apiKey));
			}

			emitter.closeAll();

			const status = options?.signal?.aborted ? "cancelled" : result.status;
			output.stopReason = stopReasonForRunStatus(status);
			if (output.stopReason === "error") {
				output.errorMessage = scrubSecrets(result.error?.message ?? "Cursor run failed", apiKey);
			}
			// `calculateCost` mutates `usage.cost` in place and returns it.
			calculateCost(model, output.usage);

			if (output.stopReason === "error" || output.stopReason === "aborted") {
				stream.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				stream.push({ type: "done", reason: "stop", message: output });
			}
			stream.end();
		} catch (error) {
			emitter.closeAll();
			const aborted = options?.signal?.aborted === true;
			output.stopReason = aborted ? "aborted" : "error";
			output.errorMessage = scrubError(error, apiKey);
			if (aborted) void run?.cancel().catch(() => undefined);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

/** Close every live Cursor agent. Wired to pi's `session_shutdown` event. */
export async function disposeCursorAgents(handles: CursorAgentHandle[]): Promise<void> {
	await Promise.all(handles.map((handle) => disposeAgentHandle(handle)));
}
