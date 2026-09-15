/**
 * pi-cursor - stream suite
 *
 * Drives the provider stream with an injected fake SDK, so every assertion here
 * is about behaviour we control: what reaches the transcript, what reaches the
 * agent, and what must never reach either.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
	CursorContentEmitter,
	describeCursorToolCall,
	planCursorTurn,
	renderCursorPrompt,
	routeCursorDelta,
	stopReasonForRunStatus,
	streamCursor,
	toPiUsage,
} from "../lib/_stream.ts";
import { registerCatalog, resetModelCatalog } from "../lib/_models.ts";
import { agentSessionCount, releaseAllAgentSessions } from "../lib/_session.ts";

const KEY = "crsr_live_0123456789abcdef";

const CATALOG = [
	{
		id: "grok-4.6",
		displayName: "Grok 4.6",
		parameters: [{ id: "effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }] }],
	},
];

function makeModel(overrides = {}) {
	return {
		id: "grok-4.6",
		name: "Grok 4.6",
		api: "cursor-sdk",
		provider: "cursor",
		baseUrl: "https://api.cursor.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		...overrides,
	};
}

function makeContext(text = "hello") {
	return { systemPrompt: "be terse", messages: [{ role: "user", content: text, timestamp: 1 }] };
}

async function collect(stream) {
	const events = [];
	for await (const event of stream) events.push(event);
	return { events, message: await stream.result() };
}

function fakeSdk(updates, result = { status: "finished", usage: { inputTokens: 10, outputTokens: 4 } }) {
	const calls = [];
	const sdk = {
		calls,
		Agent: {
			create: async (options) => {
				calls.push({ kind: "create", options });
				return {
					agentId: "agent-1",
					model: options.model,
					async [Symbol.asyncDispose]() {},
					close() {},
					send: async (message, sendOptions) => {
						calls.push({ kind: "send", message, sendOptions });
						for (const update of updates) await sendOptions.onDelta({ update });
						return {
							id: "run-1",
							cancel: async () => {},
							wait: async () => result,
						};
					},
				};
			},
		},
	};
	return sdk;
}

function deps(sdk) {
	return { loadSdk: async () => sdk, now: () => 1234, cwd: () => "/tmp/work" };
}

beforeEach(async () => {
	await releaseAllAgentSessions();
	resetModelCatalog();
	registerCatalog(CATALOG);
	delete process.env.CURSOR_BACKEND_URL;
	delete process.env.PI_CURSOR_ALLOW_BACKEND_OVERRIDE;
});

// ── Pure helpers ──────────────────────────────────────────────────────────

describe("toPiUsage", () => {
	it("maps Cursor token fields onto pi usage", () => {
		const base = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const usage = toPiUsage(
			{ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 },
			base,
		);
		assert.equal(usage.input, 10);
		assert.equal(usage.output, 5);
		assert.equal(usage.cacheRead, 2);
		assert.equal(usage.cacheWrite, 1);
		assert.equal(usage.reasoning, 3);
		assert.equal(usage.totalTokens, 18);
	});

	it("keeps previous values when a field is missing or invalid", () => {
		const base = { input: 7, output: 7, cacheRead: 7, cacheWrite: 7, totalTokens: 28, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		const usage = toPiUsage({ inputTokens: -1, outputTokens: "nope" }, base);
		assert.equal(usage.input, 7);
		assert.equal(usage.output, 7);
	});

	it("does not invent a reasoning figure", () => {
		const base = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
		assert.equal(toPiUsage({}, base).reasoning, undefined);
	});
});

describe("describeCursorToolCall", () => {
	it("summarises shell, read and grep calls without content", () => {
		assert.equal(
			describeCursorToolCall({ type: "shell", args: { command: "pnpm test", fileText: "SECRET BODY" } }),
			"shell: pnpm test",
		);
		assert.equal(describeCursorToolCall({ type: "read", args: { path: "src/app.ts" } }), "read: src/app.ts");
		assert.equal(describeCursorToolCall({ type: "grep", args: { pattern: "TODO" } }), "grep: TODO");
	});

	it("never echoes file bodies", () => {
		const line = describeCursorToolCall({ type: "write", args: { path: "a.ts", fileText: "const secret = 1" } });
		assert.equal(line.includes("secret"), false);
	});

	it("degrades to the bare tool type", () => {
		assert.equal(describeCursorToolCall({ type: "updateTodos" }), "updateTodos");
		assert.equal(describeCursorToolCall(null), undefined);
	});

	it("collapses whitespace and truncates", () => {
		const line = describeCursorToolCall({ type: "shell", args: { command: "a\n".repeat(500) } });
		assert.ok(line.length < 260);
		assert.equal(line.includes("\n"), false);
	});
});

describe("routeCursorDelta", () => {
	function sink() {
		const seen = { text: [], thinking: [], activity: [], usage: [] };
		return {
			seen,
			text: (v) => seen.text.push(v),
			thinking: (v) => seen.thinking.push(v),
			activity: (v) => seen.activity.push(v),
			usage: (v) => seen.usage.push(v),
		};
	}

	it("routes text and thinking deltas", () => {
		const s = sink();
		routeCursorDelta({ type: "text-delta", text: "hi" }, s);
		routeCursorDelta({ type: "thinking-delta", text: "hmm" }, s);
		assert.deepEqual(s.seen.text, ["hi"]);
		assert.deepEqual(s.seen.thinking, ["hmm"]);
	});

	it("turns tool activity into trace lines", () => {
		const s = sink();
		routeCursorDelta({ type: "tool-call-started", callId: "1", toolCall: { type: "shell", args: { command: "ls" } } }, s);
		routeCursorDelta({ type: "tool-call-completed", callId: "1", toolCall: { type: "shell", args: { command: "ls" } } }, s);
		assert.deepEqual(s.seen.activity, ["▸ shell: ls", "✓ shell: ls"]);
	});

	it("forwards usage from token-delta and turn-ended", () => {
		const s = sink();
		routeCursorDelta({ type: "token-delta", tokens: { inputTokens: 1 } }, s);
		routeCursorDelta({ type: "turn-ended", usage: { outputTokens: 2 } }, s);
		assert.equal(s.seen.usage.length, 2);
		assert.equal(s.seen.usage[1].outputTokens, 2);
	});

	it("ignores unknown and partial updates", () => {
		const s = sink();
		routeCursorDelta({ type: "partial-tool-call", callId: "1" }, s);
		routeCursorDelta({ type: "something-new", text: "x" }, s);
		routeCursorDelta(undefined, s);
		routeCursorDelta("nope", s);
		assert.deepEqual(s.seen, { text: [], thinking: [], activity: [], usage: [] });
	});
});

describe("renderCursorPrompt", () => {
	const context = {
		systemPrompt: "be terse",
		messages: [
			{ role: "user", content: "first", timestamp: 1 },
			{ role: "assistant", content: [{ type: "text", text: "answer one" }], timestamp: 2 },
			{ role: "user", content: "second", timestamp: 3 },
		],
	};

	it("replays history on the first turn", () => {
		const prompt = renderCursorPrompt(context, { bootstrap: true });
		assert.match(prompt, /be terse/);
		assert.match(prompt, /User: first/);
		assert.match(prompt, /Assistant: answer one/);
		assert.ok(prompt.trim().endsWith("second"));
	});

	it("sends only the newest user message afterwards", () => {
		assert.equal(renderCursorPrompt(context, { bootstrap: false }), "second");
	});

	it("handles an empty conversation", () => {
		assert.equal(renderCursorPrompt({ messages: [] }, { bootstrap: true }), "");
	});
});

describe("planCursorTurn", () => {
	it("bootstraps when no live agent exists", () => {
		const plan = planCursorTurn(makeModel(), makeContext(), { hasLiveAgent: false });
		assert.equal(plan.bootstrap, true);
		assert.equal(plan.sessionSlot, "default");
		assert.equal(plan.selection.id, "grok-4.6");
	});

	it("does not bootstrap when an agent is already live", () => {
		assert.equal(planCursorTurn(makeModel(), makeContext(), { hasLiveAgent: true }).bootstrap, false);
	});

	it("defaults the thinking level from the model capability", () => {
		assert.equal(planCursorTurn(makeModel(), makeContext(), { hasLiveAgent: true }).selection.params[0].value, "medium");
		assert.equal(
			planCursorTurn(makeModel({ reasoning: false }), makeContext(), { hasLiveAgent: true }).selection.params,
			undefined,
		);
	});
});

describe("stopReasonForRunStatus", () => {
	it("maps terminal statuses", () => {
		assert.equal(stopReasonForRunStatus("finished"), "stop");
		assert.equal(stopReasonForRunStatus("cancelled"), "aborted");
		assert.equal(stopReasonForRunStatus("error"), "error");
		assert.equal(stopReasonForRunStatus(undefined), "error");
	});
});

describe("CursorContentEmitter", () => {
	function emitter() {
		const pushed = [];
		const partial = { content: [] };
		return { pushed, partial, instance: new CursorContentEmitter({ push: (e) => pushed.push(e) }, partial) };
	}

	it("opens and closes a text block around deltas", () => {
		const { pushed, partial, instance } = emitter();
		instance.appendText("a");
		instance.appendText("b");
		instance.closeText();
		assert.deepEqual(
			pushed.map((event) => event.type),
			["text_start", "text_delta", "text_delta", "text_end"],
		);
		assert.deepEqual(partial.content, [{ type: "text", text: "ab" }]);
	});

	it("keeps text and thinking in separate blocks", () => {
		const { pushed, instance } = emitter();
		instance.appendText("answer");
		instance.appendThinking("trace");
		instance.appendText("more");
		assert.deepEqual(
			pushed.map((event) => event.type),
			["text_start", "text_delta", "text_end", "thinking_start", "thinking_delta", "thinking_end", "text_start", "text_delta"],
		);
	});

	it("bounds the activity trace", () => {
		const pushed = [];
		const instance = new CursorContentEmitter({ push: (e) => pushed.push(e) }, { content: [] }, 10);
		instance.appendActivity("0123456789ABCDEF");
		instance.appendActivity("never seen");
		const text = pushed.map((event) => event.delta ?? "").join("");
		assert.match(text, /truncated/);
		assert.equal(text.includes("never seen"), false);
	});
});

// ── End-to-end stream ─────────────────────────────────────────────────────

describe("streamCursor", () => {
	it("streams text and finishes with a stop reason", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "Hello " }, { type: "text-delta", text: "world" }]);
		const { events, message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.equal(message.stopReason, "stop");
		assert.deepEqual(message.content, [{ type: "text", text: "Hello world" }]);
		assert.deepEqual(
			events.map((event) => event.type),
			["start", "text_start", "text_delta", "text_delta", "text_end", "done"],
		);
	});

	it("renders tool activity as a bounded thinking trace, never as tool calls", async () => {
		const sdk = fakeSdk([
			{ type: "tool-call-started", callId: "1", toolCall: { type: "shell", args: { command: "pnpm test" } } },
			{ type: "text-delta", text: "done" },
		]);
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.deepEqual(
			message.content.map((block) => block.type),
			["thinking", "text"],
		);
		assert.match(message.content[0].thinking, /shell: pnpm test/);
		// pi must never receive a toolCall block: it would execute it a second time.
		assert.equal(
			message.content.some((block) => block.type === "toolCall"),
			false,
		);
	});

	it("applies usage reported by the run", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "hi" }], {
			status: "finished",
			usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 1, cacheWriteTokens: 2 },
		});
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.equal(message.usage.input, 11);
		assert.equal(message.usage.output, 7);
		assert.equal(message.usage.totalTokens, 21);
	});

	it("falls back to the terminal result when the run streamed no text", async () => {
		const sdk = fakeSdk([], { status: "finished", result: "final answer" });
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.deepEqual(message.content, [{ type: "text", text: "final answer" }]);
	});

	it("does not duplicate the answer when it was already streamed", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "streamed" }], { status: "finished", result: "streamed" });
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.deepEqual(message.content, [{ type: "text", text: "streamed" }]);
	});

	it("fails with a clear message when no key is configured", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "never" }]);
		const { events, message } = await collect(streamCursor(makeModel(), makeContext(), {}, deps(sdk)));
		assert.equal(message.stopReason, "error");
		assert.match(message.errorMessage, /\/login cursor/);
		assert.equal(sdk.calls.length, 0);
		assert.equal(events.at(-1).type, "error");
	});

	it("never sends the registration placeholder to the SDK", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "never" }]);
		const { message } = await collect(
			streamCursor(makeModel(), makeContext(), { apiKey: "pi-cursor-api-key-placeholder" }, deps(sdk)),
		);
		assert.equal(message.stopReason, "error");
		assert.equal(sdk.calls.length, 0);
	});

	it("fails closed when the backend URL was redirected off-allowlist", async () => {
		process.env.CURSOR_BACKEND_URL = "https://evil.example";
		const sdk = fakeSdk([]);
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.equal(message.stopReason, "error");
		assert.match(message.errorMessage, /only talks to|refuses/i);
		assert.equal(sdk.calls.length, 0);
		delete process.env.CURSOR_BACKEND_URL;
	});

	it("never leaks the key into the transcript, even if the SDK echoes it", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: `token is ${KEY}` }], {
			status: "error",
			error: { message: `bad key ${KEY}` },
		});
		const { events, message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		const serialised = JSON.stringify(events);
		assert.equal(serialised.includes(KEY), false);
		assert.match(message.content[0].text, /\[redacted\]/);
	});

	it("reports a failed run as an error message", async () => {
		const sdk = fakeSdk([], { status: "error", error: { message: "model unavailable" } });
		const { message } = await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		assert.equal(message.stopReason, "error");
		assert.equal(message.errorMessage, "model unavailable");
	});

	it("sends the whole history on the first turn and only the new message after", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "ok" }]);
		const context = {
			systemPrompt: "sys",
			messages: [{ role: "user", content: "first", timestamp: 1 }],
		};
		await collect(streamCursor(makeModel(), context, { apiKey: KEY, sessionId: "s1" }, deps(sdk)));
		const second = { ...context, messages: [...context.messages, { role: "assistant", content: [], timestamp: 2 }, { role: "user", content: "second", timestamp: 3 }] };
		await collect(streamCursor(makeModel(), second, { apiKey: KEY, sessionId: "s1" }, deps(sdk)));

		const sends = sdk.calls.filter((call) => call.kind === "send");
		assert.equal(sends.length, 2);
		assert.match(sends[0].message, /sys/);
		assert.match(sends[0].message, /first/);
		assert.equal(sends[1].message, "second");
	});

	it("reuses one agent per session and creates a new one for another session", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "ok" }]);
		await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY, sessionId: "s1" }, deps(sdk)));
		await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY, sessionId: "s1" }, deps(sdk)));
		assert.equal(sdk.calls.filter((call) => call.kind === "create").length, 1);
		assert.equal(agentSessionCount(), 1);

		await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY, sessionId: "s2" }, deps(sdk)));
		assert.equal(sdk.calls.filter((call) => call.kind === "create").length, 2);
		assert.equal(agentSessionCount(), 2);
	});

	it("creates the agent in the current working directory", async () => {
		const sdk = fakeSdk([{ type: "text-delta", text: "ok" }]);
		await collect(streamCursor(makeModel(), makeContext(), { apiKey: KEY }, deps(sdk)));
		const create = sdk.calls.find((call) => call.kind === "create");
		assert.equal(create.options.local.cwd, "/tmp/work");
		assert.equal(create.options.apiKey, KEY);
	});

	it("skips the SDK entirely for an empty prompt", async () => {
		const sdk = fakeSdk([]);
		const { message } = await collect(
			streamCursor(makeModel(), { messages: [] }, { apiKey: KEY }, deps(sdk)),
		);
		assert.equal(message.stopReason, "stop");
		assert.equal(sdk.calls.length, 0);
	});

	it("aborts an in-flight run when the signal fires", async () => {
		let cancelled = false;
		const controller = new AbortController();
		const sdk = {
			Agent: {
				create: async () => ({
					agentId: "a",
					async [Symbol.asyncDispose]() {},
					close() {},
					send: async () => ({
						id: "r",
						cancel: async () => {
							cancelled = true;
						},
						wait: async () => {
							controller.abort();
							return { status: "cancelled" };
						},
					}),
				}),
			},
		};
		const { message } = await collect(
			streamCursor(makeModel(), makeContext(), { apiKey: KEY, signal: controller.signal }, deps(sdk)),
		);
		assert.equal(message.stopReason, "aborted");
		assert.equal(cancelled, true);
	});
});
