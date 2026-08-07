/**
 * pi-ask - types & pure helpers tests
 *
 * Covers the schema definitions and the pure normalization/formatting
 * helpers from lib/_types.ts. UI components are not exercised here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	AskParams,
	InterviewParams,
	normalizeOptions,
	normalizeQuestions,
	normalizeInterview,
	buildDisplayOptions,
	formatSelectionAnswer,
	summarizeAnswers,
	formatInterviewLine,
} from "../lib/_types.ts";

// ── Schema smoke tests ────────────────────────────────────────────────────

test("AskParams is a TypeBox object schema with the expected properties", () => {
	assert.equal(AskParams.type, "object");
	assert.ok(AskParams.properties?.question);
	assert.ok(AskParams.properties?.options);
	// optional flags default to absent
	assert.equal(AskParams.properties?.allowOther?.anyOf?.[1]?.default ?? AskParams.properties?.allowOther?.default, undefined);
});

test("InterviewParams wraps waves and/or questions", () => {
	assert.equal(InterviewParams.type, "object");
	assert.equal(InterviewParams.properties?.waves?.type, "array");
	assert.equal(InterviewParams.properties?.questions?.type, "array");
});

// ── normalizeOptions ──────────────────────────────────────────────────────

test("normalizeOptions fills missing value with the label", () => {
	const out = normalizeOptions([{ label: "Frontend" }]);
	assert.deepEqual(out, [{ value: "Frontend", label: "Frontend" }]);
});

test("normalizeOptions keeps an explicit value", () => {
	const out = normalizeOptions([{ value: "fe", label: "Frontend" }]);
	assert.equal(out[0].value, "fe");
	assert.equal(out[0].label, "Frontend");
});

test("normalizeOptions trims labels and values", () => {
	const out = normalizeOptions([{ value: " fe ", label: "  Frontend  " }]);
	assert.deepEqual(out, [{ value: "fe", label: "Frontend" }]);
});

test("normalizeOptions drops options with empty labels", () => {
	const out = normalizeOptions([{ label: "" }, { label: "   " }, { label: "Backend" }]);
	assert.deepEqual(out, [{ value: "Backend", label: "Backend" }]);
});

test("normalizeOptions keeps descriptions", () => {
	const out = normalizeOptions([{ label: "Frontend", description: "Web UI" }]);
	assert.equal(out[0].description, "Web UI");
});

// ── normalizeQuestions ────────────────────────────────────────────────────

test("normalizeQuestions defaults labels to Q1..Qn", () => {
	const out = normalizeQuestions([
		{ id: "a", prompt: "A?", options: [{ label: "x" }] },
		{ id: "b", prompt: "B?", options: [{ label: "y" }] },
		{ id: "c", prompt: "C?", options: [{ label: "z" }] },
	]);
	assert.deepEqual(out.map((q) => q.label), ["Q1", "Q2", "Q3"]);
});

test("normalizeQuestions preserves explicit labels", () => {
	const out = normalizeQuestions([{ id: "a", label: "Scope", prompt: "A?", options: [{ label: "x" }] }]);
	assert.equal(out[0].label, "Scope");
});

test("normalizeQuestions applies defaults allowOther/multiSelect/allowNote", () => {
	const out = normalizeQuestions([{ id: "a", prompt: "A?", options: [{ label: "x" }] }]);
	assert.equal(out[0].allowOther, true);
	assert.equal(out[0].multiSelect, false);
	assert.equal(out[0].allowNote, true);
});

test("normalizeQuestions preserves explicit flags", () => {
	const out = normalizeQuestions([
		{ id: "a", prompt: "A?", options: [{ label: "x" }], allowOther: false, multiSelect: true, allowNote: false },
	]);
	assert.equal(out[0].allowOther, false);
	assert.equal(out[0].multiSelect, true);
	assert.equal(out[0].allowNote, false);
});

test("normalizeQuestions normalizes nested options", () => {
	const out = normalizeQuestions([{ id: "a", prompt: "A?", options: [{ value: "v", label: "  L  " }] }]);
	assert.deepEqual(out[0].options, [{ value: "v", label: "L" }]);
});

test("normalizeQuestions honours a start index for labels", () => {
	const out = normalizeQuestions([{ id: "a", prompt: "A?", options: [{ label: "x" }] }], 7);
	assert.equal(out[0].label, "Q7");
});

// ── normalizeInterview ────────────────────────────────────────────────────

test("normalizeInterview treats flat questions as a single unlabelled wave", () => {
	const out = normalizeInterview({
		title: "T",
		questions: [{ id: "a", prompt: "A?", options: [{ label: "x" }] }],
	});
	assert.equal(out.title, "T");
	assert.equal(out.waves.length, 1);
	assert.equal(out.waves[0].label, undefined);
	assert.equal(out.waves[0].questions.length, 1);
	assert.equal(out.waves[0].questions[0].waveLabel, undefined);
});

test("normalizeInterview keeps labelled waves and stamps each question", () => {
	const out = normalizeInterview({
		waves: [
			{
				label: "Wave 1 - Baseline",
				questions: [{ id: "a", prompt: "A?", options: [{ label: "x" }] }],
			},
			{
				label: "Wave 2 - Follow-up",
				questions: [{ id: "b", prompt: "B?", options: [{ label: "y" }] }],
			},
		],
	});
	assert.equal(out.waves.length, 2);
	assert.equal(out.waves[0].label, "Wave 1 - Baseline");
	assert.equal(out.waves[1].questions[0].waveLabel, "Wave 2 - Follow-up");
});

test("normalizeInterview defaults question labels per wave", () => {
	const out = normalizeInterview({
		waves: [
			{ label: "W1", questions: [{ id: "a", prompt: "A?", options: [{ label: "x" }] }] },
			{ label: "W2", questions: [{ id: "b", prompt: "B?", options: [{ label: "y" }] }] },
		],
	});
	assert.deepEqual(out.waves[0].questions.map((q) => q.label), ["Q1"]);
	assert.deepEqual(out.waves[1].questions.map((q) => q.label), ["Q1"]); // labels restart per wave
});

test("normalizeInterview returns no waves when nothing is provided", () => {
	const out = normalizeInterview({});
	assert.equal(out.waves.length, 0);
});

// ── buildDisplayOptions ───────────────────────────────────────────────────

test("buildDisplayOptions appends Type something when allowOther", () => {
	const q = normalizeQuestions([{ id: "a", prompt: "A?", options: [{ label: "x" }] }])[0];
	const out = buildDisplayOptions(q);
	assert.equal(out.length, 2);
	assert.equal(out[1].value, "__other__");
	assert.equal(out[1].isOther, true);
	assert.equal(out[1].label, "Type something.");
});

test("buildDisplayOptions omits Type something when allowOther is false", () => {
	const q = normalizeQuestions([{ id: "a", prompt: "A?", options: [{ label: "x" }], allowOther: false }])[0];
	const out = buildDisplayOptions(q);
	assert.equal(out.length, 1);
	assert.equal(out[0].value, "x");
});

// ── formatSelectionAnswer ─────────────────────────────────────────────────

test("formatSelectionAnswer renders index and label for a picked option", () => {
	assert.equal(formatSelectionAnswer({ value: "fe", label: "Frontend", index: 2 }), "2. Frontend");
});

test("formatSelectionAnswer renders (wrote) for a custom answer", () => {
	assert.equal(formatSelectionAnswer({ value: "ASAP", label: "ASAP", wasCustom: true }), "(wrote) ASAP");
});

test("formatSelectionAnswer appends the note when present", () => {
	assert.equal(
		formatSelectionAnswer({ value: "fe", label: "Frontend", index: 2, note: "needs auth" }),
		"2. Frontend - note: needs auth",
	);
});

// ── summarizeAnswers / formatInterviewLine ────────────────────────────────

test("summarizeAnswers joins multiple selections", () => {
	const out = summarizeAnswers([
		{ value: "pg", label: "PostgreSQL", index: 1 },
		{ value: "redis", label: "Redis", index: 3 },
	]);
	assert.equal(out, "1. PostgreSQL, 3. Redis");
});

test("formatInterviewLine prefixes the question label", () => {
	const out = formatInterviewLine("Scope", [
		{ value: "fe", label: "Frontend", index: 2, note: "team prefers it" },
	]);
	assert.equal(out, "Scope: 2. Frontend - note: team prefers it");
});
