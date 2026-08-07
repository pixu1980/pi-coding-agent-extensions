/**
 * pi-ask - schemas, types and pure helpers
 *
 * TypeBox schemas for the `ask` and `interview` tool parameters, the TS
 * types consumed by the UI components, and the pure normalization /
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

export const WaveSchema = Type.Object({
	label: Type.Optional(Type.String({ description: "Optional wave label (e.g. 'Wave 1 - Baseline')" })),
	questions: Type.Array(QuestionSchema, { description: "Questions in this wave", minItems: 1 }),
});

export const InterviewParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Optional interview title" })),
	waves: Type.Optional(
		Type.Array(WaveSchema, {
			description: "One or more waves of questions (e.g. baseline + follow-up). Each wave is a labelled group of questions.",
			minItems: 1,
		}),
	),
	questions: Type.Optional(Type.Array(QuestionSchema, { description: "Flat questions (treated as a single wave). Shorthand for a one-wave interview." })),
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
	/** Wave this question belongs to (set when the interview has waves) */
	waveLabel?: string;
}

/** A labelled group of questions (e.g. "Wave 1 - Baseline"). */
export interface NormalizedWave {
	label?: string;
	questions: NormalizedQuestion[];
}

export interface SelectAnswer {
	value: string;
	label: string;
	wasCustom?: boolean;
	/** 1-based index of the picked option; absent for custom answers */
	index?: number;
	note?: string;
}

export interface InterviewAnswer {
	questionId: string;
	questionLabel: string;
	/** Wave label when the interview has waves */
	waveLabel?: string;
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

export interface InterviewDetails {
	title?: string;
	waves: NormalizedWave[];
	answers: InterviewAnswer[];
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
 * Normalize interview params into waves. Accepts either an explicit
 * `waves` array (labelled groups) or a flat `questions` list, which is
 * treated as a single unlabelled wave. Each question carries its wave
 * label so the UI can group tabs and the review can prefix answers.
 */
export function normalizeInterview(params: {
	title?: string;
	waves?: Array<{ label?: string; questions: Array<{ id: string; label?: string; prompt: string; options: AskOption[]; allowOther?: boolean; multiSelect?: boolean; allowNote?: boolean }> }>;
	questions?: Array<{ id: string; label?: string; prompt: string; options: AskOption[]; allowOther?: boolean; multiSelect?: boolean; allowNote?: boolean }>;
}): { title?: string; waves: NormalizedWave[] } {
	const waves: NormalizedWave[] = [];

	if (params.waves && params.waves.length > 0) {
		for (const wave of params.waves) {
			const normalized = normalizeQuestions(wave.questions);
			for (const q of normalized) q.waveLabel = wave.label?.trim() || undefined;
			waves.push({ label: wave.label?.trim() || undefined, questions: normalized });
		}
	} else if (params.questions && params.questions.length > 0) {
		waves.push({ questions: normalizeQuestions(params.questions) });
	}

	return { title: params.title, waves };
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
 * an attached note is appended: "2. Frontend - note: ...".
 */
export function formatSelectionAnswer(a: SelectAnswer): string {
	const base = a.wasCustom ? `(wrote) ${a.label}` : `${a.index ?? "?"}. ${a.label}`;
	return a.note ? `${base} - note: ${a.note}` : base;
}

/** Join multiple answers with ", ". */
export function summarizeAnswers(answers: SelectAnswer[]): string {
	return answers.map(formatSelectionAnswer).join(", ");
}

/** "Scope: 2. Frontend - note: ..." - one line of an interview result. */
export function formatInterviewLine(questionLabel: string, answers: SelectAnswer[]): string {
	return `${questionLabel}: ${summarizeAnswers(answers)}`;
}
