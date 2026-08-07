/**
 * pi-ask - extension factory & command tests
 *
 * Uses the monorepo mock harness: runs the extension factory against a mock
 * ExtensionAPI and asserts tool/command registration, the /ask and
 * /ask-interview flows, and the keyword auto-trigger on the input event.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import piAskExtension from "../lib/index.ts";
import { createMockPi, createMockCtx } from "../../../test/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("extension registers ask, interview tools and the /ask, /ask-interview commands", () => {
	const { pi, tools, commands } = createMockPi();
	piAskExtension(pi);

	assert.ok(tools.has("ask"));
	assert.ok(tools.has("interview"));
	assert.ok(commands.has("ask"));
	assert.ok(commands.has("ask-interview"));
});

test("/ask command sends a follow-up single-question prompt to the model", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask").handler("project setup", ctx);

	assert.equal(calls.sendUserMessage.length, 1);
	const [content, opts] = calls.sendUserMessage[0];
	assert.equal(opts.deliverAs, "followUp");
	assert.match(content, /Single-question mode/);
	assert.match(content, /project setup/);
});

test("/ask command defaults the topic when no args are given", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask").handler("", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.match(content, /the current task/);
});

test("/ask-interview command sends a follow-up interview prompt to the model", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask-interview").handler("financial education, two waves", ctx);

	assert.equal(calls.sendUserMessage.length, 1);
	const [content, opts] = calls.sendUserMessage[0];
	assert.equal(opts.deliverAs, "followUp");
	assert.match(content, /Interview mode/);
	assert.match(content, /financial education/);
	assert.match(content, /waves/);
});

test("/ask-interview command defaults the topic when no args are given", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask-interview").handler("", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.match(content, /the current task/);
});

test("commands refuse to run in non-interactive mode", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "print", ui: { notify: () => {} } });
	await commands.get("ask").handler("topic", ctx);
	await commands.get("ask-interview").handler("topic", ctx);

	assert.equal(calls.sendUserMessage.length, 0);
});

test("auto-trigger: an interactive message with interview keywords routes to interview mode", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	await emit("input", { text: "fammi un questionario sul progetto", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 1);
	const [content] = calls.sendUserMessage[0];
	assert.match(content, /Interview mode/);
	assert.match(content, /questionario/);
});

test("auto-trigger: an interactive message with ask keywords routes to single-question mode", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	await emit("input", { text: "fammi una domanda sul progetto", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 1);
	const [content] = calls.sendUserMessage[0];
	assert.match(content, /Single-question mode/);
	assert.match(content, /progetto/);
});

test("auto-trigger: non-interactive or command input is left untouched", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	// RPC source: keyword ignored
	await emit("input", { text: "fammi un questionario", source: "rpc" }, createMockCtx());
	// Slash command text: keyword ignored
	await emit("input", { text: "/ask-interview foo", source: "interactive" }, createMockCtx());
	// Plain text without keywords: untouched
	await emit("input", { text: "puoi refactorare il modulo auth?", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 0);
});

test("auto-trigger: two-wave phrasing activates interview mode", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	await emit("input", { text: "vorrei due wave di domande sull'argomento", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 1);
	const [content] = calls.sendUserMessage[0];
	assert.match(content, /Interview mode/);
});

test("guardrail: before_agent_start appends the interview directive when the prompt says intervista", () => {
	const { pi, handlers } = createMockPi();
	piAskExtension(pi);

	const [handler] = handlers.get("before_agent_start");
	assert.ok(handler, "before_agent_start handler is registered");

	const result = handler(
		{ prompt: "vorrei un'intervista con 2 wave di domande", systemPrompt: "BASE" },
		createMockCtx(),
	);
	assert.ok(result);
	assert.match(result.systemPrompt, /BASE/);
	assert.match(result.systemPrompt, /MANDATORY INSTRUCTION/);
	assert.match(result.systemPrompt, /`interview` tool/);
});

test("guardrail: before_agent_start appends the ask directive for single-question phrases", () => {
	const { pi, handlers } = createMockPi();
	piAskExtension(pi);

	const [handler] = handlers.get("before_agent_start");
	const result = handler({ prompt: "fammi una domanda sul progetto", systemPrompt: "BASE" }, createMockCtx());
	assert.ok(result);
	assert.match(result.systemPrompt, /MANDATORY INSTRUCTION/);
	assert.match(result.systemPrompt, /`ask` tool/);
});

test("guardrail: plain prompts and slash commands are left untouched", () => {
	const { pi, handlers } = createMockPi();
	piAskExtension(pi);

	const [handler] = handlers.get("before_agent_start");
	assert.equal(handler({ prompt: "refactor the auth module", systemPrompt: "BASE" }, createMockCtx()), undefined);
	assert.equal(handler({ prompt: "/ask-interview topic", systemPrompt: "BASE" }, createMockCtx()), undefined);
	assert.equal(handler({ prompt: "", systemPrompt: "BASE" }, createMockCtx()), undefined);
});

test("package manifest exposes the extension and does not ship skills", () => {
	const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
	assert.equal(pkg.pi.skills, undefined);
	assert.ok(pkg.pi.extensions.includes("./index.ts"));
});

test("sharp interview is merged into the ask command: a challenge request asks one question with recommended answers", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask").handler("sfida il mio piano per il nuovo design dell'API", ctx);

	assert.equal(calls.sendUserMessage.length, 1);
	const [content, opts] = calls.sendUserMessage[0];
	assert.equal(opts.deliverAs, "followUp");
	assert.match(content, /Single-question mode/);
	assert.match(content, /\(recommended\)/);
	assert.match(content, /explore the codebase/);
});

test("/ask-interview with 'con dominio' enables the domain-aware interview variant", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask-interview").handler("billing redesign con dominio", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.match(content, /Interview mode/);
	assert.match(content, /CONTEXT\.md/);
	assert.match(content, /docs\/adr\//);
	assert.match(content, /Domain awareness/);
	assert.match(content, /challenge the user's terms/);
});

test("/ask-interview with --docs flag enables the domain-aware variant", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask-interview").handler("billing redesign --docs", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.match(content, /Domain awareness/);
	assert.doesNotMatch(content, /--docs/); // flag stripped from the topic
});

test("/ask-interview without docs flags has no domain block", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("ask-interview").handler("billing redesign", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.doesNotMatch(content, /Domain awareness/);
});

test("sharp-interview auto-trigger: sfida il piano routes to ask mode", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	await emit("input", { text: "sfida il mio piano per il nuovo design dell'API", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 1);
	assert.match(calls.sendUserMessage[0][0], /Single-question mode/);
	assert.match(calls.sendUserMessage[0][0], /\(recommended\)/);
});

test("auto-trigger: domain-aware phrasing routes to interview docs mode", async () => {
	const { pi, emit, calls } = createMockPi();
	piAskExtension(pi);

	await emit("input", { text: "intervistami col dominio sul modello ordini", source: "interactive" }, createMockCtx());

	assert.equal(calls.sendUserMessage.length, 1);
	assert.match(calls.sendUserMessage[0][0], /Interview mode/);
	assert.match(calls.sendUserMessage[0][0], /Domain awareness/);
});

test("guardrail: a sharp-interview prompt forces the ask tool via the merged guardrail", () => {
	const { pi, handlers } = createMockPi();
	piAskExtension(pi);

	const [handler] = handlers.get("before_agent_start");
	const result = handler({ prompt: "sfida il mio piano", systemPrompt: "BASE" }, createMockCtx());
	assert.ok(result);
	assert.match(result.systemPrompt, /\(recommended\)/);
	assert.match(result.systemPrompt, /`ask` tool/);
});
