/**
 * pi-ask — `ask` tool interactive UI tests
 *
 * Drives the `ctx.ui.custom` component with a fake TUI: renders the
 * component, simulates key presses, and asserts the tool's final result.
 *
 * Selection is instant: picking an option (digit or Enter) submits
 * immediately; a note is armed with `n` before selecting.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createAskTool } from "../lib/_ask.ts";
import { makeTheme } from "../../../test/harness.mjs";

const tool = createAskTool();

// Raw terminal sequences expected by matchesKey (same as pi-sessions fixtures)
const KEY = { escape: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B", space: " " };

/**
 * Install a driver that resolves `ctx.ui.custom` by instantiating the
 * component factory against a fake TUI. Returns an object to render and
 * send keys; `execute()` must be called before driving.
 */
function installAskDriver(ctx) {
	let component;
	ctx.ui.custom = (factory) =>
		new Promise((resolve) => {
			const tui = {
				terminal: { rows: 40 },
				requestRender() {},
			};
			component = factory(tui, makeTheme(), {}, resolve);
		});
	return {
		render: () => component.render(100).join("\n"),
		key: (k) => component.handleInput(k),
		/** type a string char by char through the inline editor */
		type: (text) => {
			for (const ch of text) component.handleInput(ch);
		},
	};
}

function makeCtx() {
	return {
		mode: "tui",
		ui: {},
	};
}

const STACK_PARAMS = {
	question: "Which stack?",
	options: [
		{ value: "rust", label: "Rust" },
		{ value: "go", label: "Go" },
		{ value: "ts", label: "TypeScript" },
	],
};

test("single select: digit key submits immediately", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c1", STACK_PARAMS, undefined, undefined, ctx);

	// Initial render shows question, options and the Type something. entry
	const text = driver.render();
	assert.match(text, /Which stack\?/);
	assert.match(text, /1\. Rust/);
	assert.match(text, /2\. Go/);
	assert.match(text, /Type something\./);

	// Select option 1 (Rust) with the digit key → submits immediately
	driver.key("1");

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.deepEqual(result.details.answer, {
		value: "rust",
		label: "Rust",
		wasCustom: false,
		index: 1,
	});
	assert.equal(result.details.selections, null);
	assert.equal(result.content[0].text, "User answered: 1. Rust");
});

test("single select: arrow + Enter submits immediately", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c1b", STACK_PARAMS, undefined, undefined, ctx);

	driver.key(KEY.down); // Go
	driver.key(KEY.down); // TypeScript
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answer.label, "TypeScript");
	assert.equal(result.details.answer.index, 3);
});

test("note: n arms a note, then the selection submits with it", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c1c", STACK_PARAMS, undefined, undefined, ctx);

	// Arm a note first
	driver.key("n");
	let text = driver.render();
	assert.match(text, /Note \(optional/);
	driver.type("needs review");
	driver.key(KEY.enter);

	// Note is armed and shown; nothing submitted yet
	text = driver.render();
	assert.match(text, /note: needs review/);

	// Now select — one key, done
	driver.key("1");

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.deepEqual(result.details.answer, {
		value: "rust",
		label: "Rust",
		wasCustom: false,
		index: 1,
		note: "needs review",
	});
	assert.equal(result.content[0].text, "User answered: 1. Rust — note: needs review");
});

test("custom answer: Type something auto-enters write mode when highlighted, one Enter submits", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c2", STACK_PARAMS, undefined, undefined, ctx);

	// Navigate down three times → Type something. is highlighted → write mode opens automatically
	driver.key(KEY.down);
	driver.key(KEY.down);
	driver.key(KEY.down);
	let text = driver.render();
	assert.match(text, /Your answer:/);

	driver.type("Kotlin Multiplatform");
	driver.key(KEY.enter); // single Enter after typing → submitted

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.deepEqual(result.details.answer, {
		value: "Kotlin Multiplatform",
		label: "Kotlin Multiplatform",
		wasCustom: true,
	});
	assert.equal(result.content[0].text, "User answered: (wrote) Kotlin Multiplatform");
});

test("type something: write mode clears when it loses the highlight", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c2b", STACK_PARAMS, undefined, undefined, ctx);

	driver.key(KEY.down);
	driver.key(KEY.down);
	driver.key(KEY.down);
	let text = driver.render();
	assert.match(text, /Your answer:/);

	driver.type("partial");
	text = driver.render();
	assert.match(text, /partial/);

	driver.key(KEY.up); // loses highlight → field clears, write mode closes
	text = driver.render();
	assert.doesNotMatch(text, /Your answer:/);
	assert.doesNotMatch(text, /partial/);

	driver.key(KEY.escape);
	await execPromise;
});

test("multi select: digits toggle, Enter submits all", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute(
		"c3",
		{ ...STACK_PARAMS, multiSelect: true },
		undefined,
		undefined,
		ctx,
	);

	let text = driver.render();
	assert.match(text, /\[ \] 1\. Rust/);

	driver.key("1"); // Rust
	driver.key("3"); // TypeScript
	text = driver.render();
	assert.match(text, /\[x\] 1\. Rust/);
	assert.match(text, /\[x\] 3\. TypeScript/);
	assert.match(text, /\[ \] 2\. Go/);

	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answer, null);
	assert.deepEqual(result.details.selections?.map((a) => a.value), ["rust", "ts"]);
	assert.equal(result.content[0].text, "User selected: 1. Rust, 3. TypeScript");
});

test("escape cancels with no answer", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute("c4", STACK_PARAMS, undefined, undefined, ctx);
	driver.key(KEY.escape);

	const result = await execPromise;
	assert.equal(result.details.cancelled, true);
	assert.equal(result.details.answer, null);
	assert.match(result.content[0].text, /cancelled/i);
});

test("allowOther:false hides the Type something entry", async () => {
	const ctx = makeCtx();
	const driver = installAskDriver(ctx);

	const execPromise = tool.execute(
		"c5",
		{ ...STACK_PARAMS, allowOther: false },
		undefined,
		undefined,
		ctx,
	);

	const text = driver.render();
	assert.doesNotMatch(text, /Type something\./);

	// Select option 1 → submits immediately
	driver.key("1");
	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answer.label, "Rust");
});
