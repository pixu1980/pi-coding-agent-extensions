/**
 * pi-ask — pure answer-building helpers
 *
 * Selection logic shared by the `ask` and `interview` UI components.
 * No TUI imports: unit-testable without a terminal.
 */

import type { DisplayOption, SelectAnswer } from "./_types.ts";

/**
 * Map a digit key press to an option index.
 * "1"-"9" → 0-8, "0" → 9 (the tenth option). Anything else → null.
 */
export function parseDigitKey(key: string): number | null {
	if (key.length === 1) {
		if (key >= "1" && key <= "9") return key.charCodeAt(0) - 49;
		if (key === "0") return 9;
	}
	return null;
}

/** Build the answer for a picked option at `index` (0-based). */
export function selectionFromIndex(opts: DisplayOption[], index: number): SelectAnswer {
	const opt = opts[index];
	return { value: opt.value, label: opt.label, wasCustom: false, index: index + 1 };
}

/** Build the answer for a typed custom response (trimmed). */
export function selectionFromCustom(text: string): SelectAnswer {
	const t = text.trim();
	return { value: t, label: t, wasCustom: true };
}

/** Attach a trimmed note; empty notes are dropped (answer unchanged). */
export function withNote(a: SelectAnswer, note: string): SelectAnswer {
	const n = note.trim();
	return n ? { ...a, note: n } : a;
}

/** Return a new Set with `index` toggled (immutable). */
export function toggleIndex(set: Set<number>, index: number): Set<number> {
	const next = new Set(set);
	if (next.has(index)) next.delete(index);
	else next.add(index);
	return next;
}
