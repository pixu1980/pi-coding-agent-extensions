/**
 * pi-ask - `interview` tool interactive UI tests
 *
 * Drives the custom component with a fake TUI (same driver pattern as the
 * `ask` tests) and asserts the multi-question interview flow, including
 * sequential multi-questionnaire interviews (waves are rendered one
 * questionnaire at a time; the next starts only after confirming the
 * previous one).
 *
 * Digits answer and advance to the next tab; Enter on a question tab
 * records the highlighted option (or current multi-selects) and advances
 * to the next question - on the last question it lands on the review tab,
 * where Enter submits the current questionnaire and moves on to the next.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createInterviewTool } from "../lib/_interview-tool.ts";
import { makeTheme } from "../../../test/harness.mjs";

const tool = createInterviewTool();

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

/**
 * Driver for sequential interviews: `ui.custom` is called once per
 * questionnaire chunk, so this accumulates every component and lets the
 * test drive each one in turn.
 */
function installSequentialDriver(ctx) {
	const components = [];
	const arrivals = [];
	ctx.ui.custom = (factory) =>
		new Promise((resolve) => {
			const tui = {
				terminal: { rows: 40 },
				requestRender() {},
			};
			components.push(factory(tui, makeTheme(), {}, resolve));
			arrivals.push(() => resolve);
		});
	const waitForComponent = async (index, timeoutMs = 1000) => {
		const start = Date.now();
		while (components.length <= index) {
			if (Date.now() - start > timeoutMs) throw new Error(`component ${index} never appeared`);
			await new Promise((r) => setTimeout(r, 5));
		}
	};
	return {
		components,
		waitForComponent,
		render: (i) => components[i].render(100).join("\n"),
		key: (k, i) => components[i].handleInput(k),
		type: (text, i) => {
			for (const ch of text) components[i].handleInput(ch);
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

test("interview: answering a question advances immediately", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q1", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1 tab visible with tab bar
	let text = driver.render();
	assert.match(text, /Which stack\?/);
	assert.match(text, /□ Q1/);
	assert.match(text, /□ Q2/);

	// Answer Q1 (Frontend) - a single digit key records and advances
	driver.key("1");
	text = driver.render();
	assert.match(text, /How urgent\?/); // now on Q2

	// Answer Q2 (High) - advances to review
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

test("interview: custom answer advances to the next question on Enter", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q2", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1: navigate to "Type something." (last of 3 entries) → auto write mode
	driver.key(KEY.down);
	driver.key(KEY.down);
	let text = driver.render();
	assert.match(text, /Your answer:/);
	driver.type("Mobile-first PWA");
	driver.key(KEY.enter); // single Enter → recorded + advances to Q2

	// Now on Q2, not the review tab
	text = driver.render();
	assert.match(text, /How urgent\?/);
	assert.doesNotMatch(text, /Ready to submit/);

	// Answer Q2 (High) → last question lands on review tab
	driver.key("2");
	text = driver.render();
	assert.match(text, /Ready to submit/);
	assert.match(text, /Q1: \(wrote\) Mobile-first PWA/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answers[0].answers[0].wasCustom, true);
	assert.equal(result.details.answers[0].answers[0].label, "Mobile-first PWA");
});

test("interview: note armed with n travels with the next answer", async () => {
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
	assert.match(text, /Q1: 1\. Frontend - note: needs sign-off/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.answers[0].answers[0].note, "needs sign-off");
});

test("interview: multi-select question toggles and submits", async () => {
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

test("interview: Enter on a question tab records and advances to the next question", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q-enter", INTERVIEW_PARAMS, undefined, undefined, ctx);

	// Q1 visible; highlight is on the first option
	let text = driver.render();
	assert.match(text, /Which stack\?/);

	// Enter records the highlighted option (Frontend) and advances to Q2
	driver.key(KEY.enter);
	text = driver.render();
	assert.match(text, /How urgent\?/); // now on Q2, not the review tab
	assert.doesNotMatch(text, /Ready to submit/);

	// Q2 is the last question: Enter lands on the review tab
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

test("interview: escape on first question cancels the whole interview", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute("q5", INTERVIEW_PARAMS, undefined, undefined, ctx);
	driver.key(KEY.escape);

	const result = await execPromise;
	assert.equal(result.details.cancelled, true);
	assert.match(result.content[0].text, /cancelled/i);
});

test("interview: back navigation shows the recorded answer and can change it", async () => {
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

test("interview: non-TUI mode returns a fallback error result", async () => {
	const result = await tool.execute("q7", INTERVIEW_PARAMS, undefined, undefined, { mode: "print" });
	assert.match(result.content[0].text, /UI not available/);
	assert.equal(result.details.cancelled, true);
});

test("interview: registers with the right name and schema", () => {
	assert.equal(tool.name, "interview");
	assert.equal(tool.label, "Interview");
	assert.equal(tool.parameters.type, "object");
	assert.equal(tool.parameters.properties?.waves?.type, "array");
	assert.equal(tool.parameters.properties?.questions?.type, "array");
});

test("interview: multi-wave interview runs each wave as a sequential questionnaire", async () => {
	const ctx = makeCtx();
	const driver = installSequentialDriver(ctx);

	const execPromise = tool.execute(
		"q-waves",
		{
			title: "Financial education",
			waves: [
				{
					label: "Wave 1 - Baseline",
					questions: [
						{ id: "w1q1", prompt: "How old are you?", options: [{ value: "18", label: "18-24" }, { value: "25", label: "25-34" }] },
						{ id: "w1q2", prompt: "Any concerns?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
					],
				},
				{
					label: "Wave 2 - Follow-up",
					questions: [{ id: "w2q1", prompt: "Any concerns now?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }],
				},
			],
		},
		undefined,
		undefined,
		ctx,
	);

	// Questionnaire 1: Wave 1 - Baseline (2 questions), shown on its own
	await driver.waitForComponent(0);
	let text = driver.render(0);
	assert.match(text, /Financial education/);
	assert.match(text, /Wave 1 - Baseline/);
	assert.match(text, /Questionnaire 1\/2/);
	assert.match(text, /How old are you\?/);
	assert.doesNotMatch(text, /Any concerns now\?/); // wave 2 not visible yet

	driver.key("1", 0); // w1q1 → 18-24
	driver.key("1", 0); // w1q2 → Yes
	text = driver.render(0);
	assert.match(text, /Ready to submit/);
	assert.match(text, /next questionnaire/); // confirms there is a part 2
	driver.key(KEY.enter, 0); // submit questionnaire 1

	// Questionnaire 2: Wave 2 - Follow-up (1 question) starts only after submit
	await driver.waitForComponent(1);
	text = driver.render(1);
	assert.match(text, /Wave 2 - Follow-up/);
	assert.match(text, /Questionnaire 2\/2/);
	assert.match(text, /Any concerns now\?/);
	driver.key("1", 1);
	text = driver.render(1);
	assert.match(text, /Ready to submit/);
	assert.doesNotMatch(text, /next questionnaire/); // last one: plain submit
	driver.key(KEY.enter, 1);

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers.length, 3);
	assert.equal(result.details.answers[0].waveLabel, "Wave 1 - Baseline");
	assert.equal(result.details.answers[2].waveLabel, "Wave 2 - Follow-up");
	assert.match(result.content[0].text, /Wave 1 - Baseline · Q1: 1\. 18-24/);
	assert.match(result.content[0].text, /Wave 2 - Follow-up · Q1: 1\. Yes/);
});

test("interview: a wave beyond 10 questions is respected in full (no split)", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const bigWave = Array.from({ length: 14 }, (_, i) => ({
		id: `q${i + 1}`,
		prompt: `Question ${i + 1}?`,
		options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
	}));

	const execPromise = tool.execute(
		"q-big-wave",
		{
			title: "Long survey",
			waves: [{ label: "Wave 1 - Full", questions: bigWave }],
		},
		undefined,
		undefined,
		ctx,
	);

	// All 14 questions live in a single questionnaire: no split header, no "1/2"
	let text = driver.render();
	assert.match(text, /Question 1\?/);
	assert.doesNotMatch(text, /Questionnaire 1\/2/);

	for (let i = 0; i < 14; i++) driver.key("1");
	text = driver.render();
	assert.match(text, /Ready to submit/);
	assert.doesNotMatch(text, /next questionnaire/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers.length, 14);
	assert.equal(result.details.answers[0].waveLabel, "Wave 1 - Full");
	assert.match(result.content[0].text, /Q14: 1\. A/);
});

test("interview: flat questions are treated as a single unlabelled wave", async () => {
	const ctx = makeCtx();
	const driver = installDriver(ctx);

	const execPromise = tool.execute(
		"q-flat",
		{
			title: "Quick check",
			questions: [
				{ id: "a", prompt: "Pick a stack", options: [{ value: "ts", label: "TypeScript" }, { value: "rs", label: "Rust" }] },
				{ id: "b", prompt: "Deadline?", options: [{ value: "soon", label: "Soon" }, { value: "later", label: "Later" }] },
			],
		},
		undefined,
		undefined,
		ctx,
	);

	let text = driver.render();
	assert.match(text, /Pick a stack/);
	assert.doesNotMatch(text, /Wave 1 ·/); // no wave prefix for a single wave
	assert.doesNotMatch(text, /Questionnaire 1\/1/); // no progress header for a single questionnaire

	driver.key("1");
	driver.key("1");
	text = driver.render();
	assert.match(text, /Ready to submit/);
	driver.key(KEY.enter);

	const result = await execPromise;
	assert.equal(result.details.waves.length, 1);
	assert.equal(result.details.answers[0].waveLabel, undefined);
	assert.doesNotMatch(result.content[0].text, /· Q1/); // no wave prefix in output
});
