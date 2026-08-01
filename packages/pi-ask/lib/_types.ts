/**
 * pi-ask — schemas, types and pure helpers
 *
 * TypeBox schemas for the `ask` and `questionnaire` tool parameters, the
 * TS types consumed by the UI components, and the pure normalization /
 * formatting helpers shared by both tools. Nothing here touches the TUI,
 * which keeps this module unit-testable without a terminal.
 */

import { Type } from "typebox";

// ── Schemas ────────────────────────────────────────────────────────────────

export const OptionSchema = Type.Object({
	value: Type.Optional(
		Type.String({ description: "Value returned to the model when selected (defaults to the label)" }),
	),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below the label" })),
});

export const AskParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	options: Type.Array(OptionSchema, { description: "Answer options", minItems: 1 }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow a typed custom answer (default: true)" })),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections (default: false)" })),
	allowNote: Type.Optional(Type.Boolean({ description: "Allow attaching a note to the answer (default: true)" })),
});

export const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for the question" }),
	label: Type.Optional(Type.String({ description: "Short label for the tab bar (defaults to Q1, Q2, ...)" })),
	prompt: Type.String({ description: "The full question text" }),
	options: Type.Array(OptionSchema, { description: "Answer options", minItems: 1 }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow a typed custom answer (default: true)" })),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple selections (default: false)" })),
	allowNote: Type.Optional(Type.Boolean({ description: "Allow attaching a note to the answer (default: true)" })),
});

export const QuestionnaireParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Optional questionnaire title" })),
	questions: Type.Array(QuestionSchema, { description: "Questions to ask", minItems: 1 }),
});

// ── Types ──────────────────────────────────────────────────────────────────

export interface AskOption {
	value?: string;
	label: string;
	description?: string;
}

export interface NormalizedOption {
	value: string;
	label: string;
	description?: string;
}

export interface DisplayOption extends NormalizedOption {
	isOther?: boolean;
}

export interface NormalizedQuestion {
	id: string;
	label: string;
	prompt: string;
	options: NormalizedOption[];
	allowOther: boolean;
	multiSelect: boolean;
	allowNote: boolean;
}

export interface SelectAnswer {
	value: string;
	label: string;
	wasCustom?: boolean;
	/** 1-based index of the picked option; absent for custom answers */
	index?: number;
	note?: string;
}

export interface QuestionnaireAnswer {
	questionId: string;
	questionLabel: string;
	/** One or more selected answers (multi-select / custom) */
	answers: SelectAnswer[];
}

export interface AskDetails {
	question: string;
	/** Simple display labels, without the "Type something." pseudo-option */
	options: string[];
	/** Single-select answer; null when cancelled or when multiSelect is used */
	answer: SelectAnswer | null;
	/** Multi-select answers; null when single-select or cancelled */
	selections: SelectAnswer[] | null;
	cancelled: boolean;
}

export interface QuestionnaireDetails {
	title?: string;
	questions: NormalizedQuestion[];
	answers: QuestionnaireAnswer[];
	cancelled: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const OTHER_VALUE = "__other__";
export const OTHER_LABEL = "Type something.";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalize raw options: fill missing values with the label, trim label and
 * value, drop options with empty labels.
 */
export function normalizeOptions(options: AskOption[]): NormalizedOption[] {
	const out: NormalizedOption[] = [];
	for (const opt of options) {
		const label = opt.label.trim();
		if (!label) continue;
		const value = (opt.value ?? "").trim() || label;
		if (!value) continue;
		const normalized: NormalizedOption = { value, label };
		if (opt.description) normalized.description = opt.description;
		out.push(normalized);
	}
	return out;
}

/**
 * Normalize raw questions: default tab labels to Q1..Qn (from `startIndex`),
 * default allowOther/allowNote to true and multiSelect to false, and
 * normalize each option list.
 */
export function normalizeQuestions(
	raw: Array<{
		id: string;
		label?: string;
		prompt: string;
		options: AskOption[];
		allowOther?: boolean;
		multiSelect?: boolean;
		allowNote?: boolean;
	}>,
	startIndex = 1,
): NormalizedQuestion[] {
	return raw.map((q, i) => ({
		id: q.id,
		label: q.label?.trim() || `Q${startIndex + i}`,
		prompt: q.prompt,
		options: normalizeOptions(q.options),
		allowOther: q.allowOther !== false,
		multiSelect: q.multiSelect === true,
		allowNote: q.allowNote !== false,
	}));
}

/**
 * Build the options shown in the UI: the normalized options plus the
 * "Type something." pseudo-option when custom answers are allowed.
 */
export function buildDisplayOptions(q: NormalizedQuestion): DisplayOption[] {
	const opts: DisplayOption[] = [...q.options];
	if (q.allowOther) {
		opts.push({ value: OTHER_VALUE, label: OTHER_LABEL, isOther: true });
	}
	return opts;
}

/**
 * Render a single answer for the model-facing content text.
 * Picked option: "2. Frontend"; custom: "(wrote) ASAP";
 * an attached note is appended: "2. Frontend — note: ...".
 */
export function formatSelectionAnswer(a: SelectAnswer): string {
	const base = a.wasCustom ? `(wrote) ${a.label}` : `${a.index ?? "?"}. ${a.label}`;
	return a.note ? `${base} — note: ${a.note}` : base;
}

/** Join multiple answers with ", ". */
export function summarizeAnswers(answers: SelectAnswer[]): string {
	return answers.map(formatSelectionAnswer).join(", ");
}

/** "Scope: 2. Frontend — note: ..." — one line of a questionnaire result. */
export function formatQuestionnaireLine(questionLabel: string, answers: SelectAnswer[]): string {
	return `${questionLabel}: ${summarizeAnswers(answers)}`;
}
