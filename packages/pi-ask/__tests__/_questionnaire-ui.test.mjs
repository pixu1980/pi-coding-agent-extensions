/**
 * pi-ask — `questionnaire` tool interactive UI tests
 *
 * Drives the custom component with a fake TUI (same driver pattern as the
 * `ask` tests) and asserts the multi-question interview flow.
 *
 * Digits answer and advance to the next tab; Enter on a question tab
 * records the highlighted option (or current multi-selects) and jumps
 * straight to the review tab, where Enter submits everything.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createQuestionnaireTool } from "../lib/_questionnaire.ts";
import { makeTheme } from "../../../test/harness.mjs";

const tool = createQuestionnaireTool();

const KEY = { escape: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", space: " " };

function installDriver(ctx) {
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
		type: (text) => {
			for (const ch of text) component.handleInput(ch);
		},
	};
}

function makeCtx() {
	return { mode: "tui", ui: {} };
}

const INTERVIEW_PARAMS = {
	title: "Project setup",
	questions: [
		{
			id: "scope",
			prompt: "Which stack?",
			options: [
				{ value: "fe", label: "Frontend" },
				{ value: "be", label: "Backend" },
			],
		},
		{
			id: "priority",
			prompt: "How urgent?",
			options: [
				{ value: "low", label: "Low" },
				{ value: "high", label: "High" },
			],
		},
	],
};

test("questionnaire: answering a question advances immediately", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q1", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1 tab visible with tab bar
	let text = driver.render();
	assert.match(text, /Which stack\?/);
	assert.match(text, /□ Q1/);
	assert.match(text, /□ Q2/);

	// Answer Q1 (Frontend) — a single digit key records and advances
	driver.key("1");
	text = driver.render();
	assert.match(text, /How urgent\?/); // now on Q2

	// Answer Q2 (High) — advances to review
	driver.key("2");
	text = driver.render();
	assert.match(text, /Ready to submit/);
	assert.match(text, /Q1: 1\. Frontend/);
	assert.match(text, /Q2: 2\. High/);
	assert.match(text, /Press Enter to submit/);

	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers.length, 2);
	assert.deepEqual(result.details.answers[0], {
		questionId: "scope",
		questionLabel: "Q1",
		answers: [{ value: "fe", label: "Frontend", wasCustom: false, index: 1 }],
	});
	assert.equal(result.content[0].text, "Q1: 1. Frontend\nQ2: 2. High");
});

test("questionnaire: custom answer jumps to the review tab on Enter", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q2", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1: navigate to "Type something." (last of 3 entries) → auto write mode
	driver.key(KEY.down);
	driver.key(KEY.down);
	let text = driver.render();
	assert.match(text, /Your answer:/);
	driver.type("Mobile-first PWA");
	driver.key(KEY.enter); // single Enter → recorded + jumps to review tab

	// Review tab shows the recorded custom answer; Q2 still unanswered
	text = driver.render();
	assert.match(text, /Ready to submit/);
	assert.match(text, /Q1: \(wrote\) Mobile-first PWA/);
	assert.match(text, /Unanswered: Q2/);

	// Go back to Q2, answer it, then submit from review
	driver.key(KEY.left);
	text = driver.render();
	assert.match(text, /How urgent\?/);
	driver.key("1");
	text = driver.render();
	assert.match(text, /Ready to submit/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answers[0].answers[0].wasCustom, true);
	assert.equal(result.details.answers[0].answers[0].label, "Mobile-first PWA");
});

test("questionnaire: note armed with n travels with the next answer", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q3", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Arm a note before answering Q1
	driver.key("n");
	let text = driver.render();
	assert.match(text, /Note \(optional/);
	driver.type("needs sign-off");
	driver.key(KEY.enter);

	// Answer Q1 → advances with the note attached
	driver.key("1");
	text = driver.render();
	assert.match(text, /How urgent\?/);

	// Q2 + submit
	driver.key("1");
	text = driver.render();
	assert.match(text, /Q1: 1\. Frontend — note: needs sign-off/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answers[0].answers[0].note, "needs sign-off");
});

test("questionnaire: multi-select question toggles and submits", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute(
		"q4",
		{
			questions: [
				{
					id: "stack",
					prompt: "Pick languages",
					multiSelect: true,
					options: [
						{ value: "ts", label: "TypeScript" },
						{ value: "rs", label: "Rust" },
						{ value: "py", label: "Python" },
					],
				},
			],
		},
		undefined,
		undefined,
		ctx,
	);

	// Toggle first two with digits
	driver.key("1");
	driver.key("2");
	let text = driver.render();
	assert.match(text, /\[x\] 1\. TypeScript/);
	assert.match(text, /\[x\] 2\. Rust/);
	assert.match(text, /\[ \] 3\. Python/);

	driver.key(KEY.enter); // confirm → review tab
	text = driver.render();
	assert.match(text, /Q1: 1\. TypeScript, 2\. Rust/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.deepEqual(result.details.answers[0].answers.map((a) => a.value), ["ts", "rs"]);
});

test("questionnaire: Enter on a question tab records and jumps to the review tab", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q-enter", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1 visible; highlight is on the first option
	let text = driver.render();
	assert.match(text, /Which stack\?/);

	// Enter records the highlighted option (Frontend) and jumps to review
	driver.key(KEY.enter);
	text = driver.render();
	assert.match(text, /Ready to submit/);
	assert.match(text, /Q1: 1\. Frontend/);
	assert.match(text, /Unanswered: Q2/);

	// Left arrow back to Q2, highlight the second option, Enter → review again
	driver.key(KEY.left);
	text = driver.render();
	assert.match(text, /How urgent\?/);
	driver.key(KEY.down); // highlight "High"
	driver.key(KEY.enter);

	text = driver.render();
	assert.match(text, /Q1: 1\. Frontend/);
	assert.match(text, /Q2: 2\. High/);
	assert.match(text, /Press Enter to submit/);

	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers.length, 2);
	assert.equal(result.details.answers[1].answers[0].label, "High");
});

test("questionnaire: escape on first question cancels the whole questionnaire", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q5", INTERVIEW_PARAMS, undefined, undefined, ctx);
	driver.key(KEY.escape);

	const result = await execPromise;
	assert.equal(result.details.cancelled, true);
	assert.match(result.content[0].text, /cancelled/i);
});

test("questionnaire: back navigation shows the recorded answer and can change it", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q6", INTERVIEW_PARAMS, undefined, undefined, ctx);

	driver.key("1"); // Frontend recorded → advanced
	driver.key(KEY.left); // back to Q1

	let text = driver.render();
	assert.match(text, /✓\s*1\. Frontend/); // recorded answer shown

	driver.key("2"); // change to Backend → advances again
	driver.key("1"); // Q2
	text = driver.render();
	assert.match(text, /Q1: 2\. Backend/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answers[0].answers[0].label, "Backend");
});

test("questionnaire: non-TUI mode returns a fallback error result", async () => {
	const result = await tool.execute("q7", INTERVIEW_PARAMS, undefined, undefined, { mode: "print" });
	assert.match(result.content[0].text, /UI not available/);
	assert.equal(result.details.cancelled, true);
});

test("questionnaire: registers with the right name and schema", () => {
	assert.equal(tool.name, "questionnaire");
	assert.equal(tool.label, "Questionnaire");
	assert.equal(tool.parameters.type, "object");
	assert.equal(tool.parameters.properties?.questions?.type, "array");
});
