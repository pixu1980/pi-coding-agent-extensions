/**
 * pi-ask - logic tests
 *
 * Pure answer-building helpers from lib/_logic.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	parseDigitKey,
	selectionFromIndex,
	selectionFromCustom,
	withNote,
	toggleIndex,
} from "../lib/_logic.ts";

test("parseDigitKey maps 1-9 to 0-8", () => {
	assert.equal(parseDigitKey("1"), 0);
	assert.equal(parseDigitKey("5"), 4);
	assert.equal(parseDigitKey("9"), 8);
});

test("parseDigitKey maps 0 to index 9", () => {
	assert.equal(parseDigitKey("0"), 9);
});

test("parseDigitKey returns null for non-digits", () => {
	assert.equal(parseDigitKey("a"), null);
	assert.equal(parseDigitKey(""), null);
	assert.equal(parseDigitKey("10"), null);
});

test("selectionFromIndex builds a non-custom answer with 1-based index", () => {
	const opts = [
		{ value: "fe", label: "Frontend" },
		{ value: "be", label: "Backend" },
	];
	const a = selectionFromIndex(opts, 1);
	assert.deepEqual(a, { value: "be", label: "Backend", wasCustom: false, index: 2 });
});

test("selectionFromCustom trims and flags wasCustom, no index", () => {
	const a = selectionFromCustom("  ASAP  ");
	assert.deepEqual(a, { value: "ASAP", label: "ASAP", wasCustom: true });
});

test("withNote attaches a trimmed note", () => {
	const a = withNote({ value: "fe", label: "Frontend", wasCustom: false, index: 1 }, "  needs auth  ");
	assert.equal(a.note, "needs auth");
});

test("withNote drops empty notes", () => {
	const a = withNote({ value: "fe", label: "Frontend", wasCustom: false, index: 1 }, "   ");
	assert.equal(a.note, undefined);
	assert.deepEqual(Object.keys(a).sort(), ["index", "label", "value", "wasCustom"]);
});

test("toggleIndex adds and removes indices immutably", () => {
	let s = new Set();
	s = toggleIndex(s, 2);
	assert.deepEqual([...s], [2]);
	s = toggleIndex(s, 0);
	assert.deepEqual([...s].sort((a, b) => a - b), [0, 2]);
	s = toggleIndex(s, 2);
	assert.deepEqual([...s], [0]);
});
