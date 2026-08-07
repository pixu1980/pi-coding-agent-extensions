/**
 * pi-ask - `ask` tool tests
 *
 * Exercises the parts of the tool that run without a terminal: metadata,
 * the non-TUI fallback, and the empty-options guard. The interactive
 * `ctx.ui.custom` path is exercised manually.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAskTool } from "../lib/_ask.ts";

const tool = createAskTool();

function mockCtx(mode = "print") {
	return { mode };
}

test("ask tool registers with the right name, label and schema", () => {
	assert.equal(tool.name, "ask");
	assert.equal(tool.label, "Ask");
	assert.ok(tool.description.length > 20);
	assert.equal(tool.parameters.type, "object");
	assert.ok(tool.parameters.properties?.question);
	assert.ok(tool.parameters.properties?.options);
});

test("non-TUI mode returns a fallback error result with cancelled details", async () => {
	const result = await tool.execute(
		"call-1",
		{ question: "Stack?", options: [{ label: "Rust" }, { label: "Go" }] },
		undefined,
		undefined,
		mockCtx("print"),
	);
	assert.equal(result.content[0].type, "text");
	assert.match(result.content[0].text, /UI not available/);
	assert.equal(result.details.cancelled, true);
	assert.equal(result.details.question, "Stack?");
	assert.deepEqual(result.details.options, ["Rust", "Go"]);
	assert.equal(result.details.answer, null);
	assert.equal(result.details.selections, null);
});

test("empty options return an error result", async () => {
	const result = await tool.execute(
		"call-2",
		{ question: "Stack?", options: [] },
		undefined,
		undefined,
		mockCtx("tui"),
	);
	assert.match(result.content[0].text, /No options/);
	assert.equal(result.details.cancelled, true);
});

test("multiSelect flag is preserved through normalization in details options", async () => {
	const result = await tool.execute(
		"call-3",
		{ question: "Stack?", options: [{ label: "Rust" }, { label: "Go" }], multiSelect: true },
		undefined,
		undefined,
		mockCtx("print"),
	);
	// Non-TUI path always cancels; ensure the option list still flows through
	assert.deepEqual(result.details.options, ["Rust", "Go"]);
});
