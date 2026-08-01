/**
 * pi-ask — `interview` tool (multi-question, sequential questionnaires)
 *
 * Renders one questionnaire at a time with a tab bar, a review/Submit tab,
 * per-question notes (`n`), custom answers ("Type something.") and
 * multi-select.
 *
 * The caller controls the structure: pass `waves` with a label and any
 * number of questions per wave (decided by hierarchical/structural
 * criteria, e.g. sections, difficulty, phases). Each wave runs as its own
 * sequential questionnaire, respected in full — never split, even beyond
 * 10 questions. The next questionnaire only starts after the user confirms
 * the previous one, so a two-wave study becomes two questionnaires with a
 * confirmation step in between. Answers are aggregated across waves in the
 * final result. A flat `questions` list is a single unlabelled wave.
 *
 * Inside a questionnaire: left/right arrows (or Tab) switch tabs freely —
 * the user can hop between questions at will, answering each one with
 * digits (record + advance) or by highlighting an option with ↑/↓. Enter
 * on a question tab records the highlighted option (or the current
 * multi-selects) and advances to the next question — on the last question
 * it lands on the review tab, where Enter submits the questionnaire and
 * moves on to the next one. A note is armed with `n` before selecting and
 * travels with the next answer.
 */

import type { ThemeColor, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
	InterviewParams,
	buildDisplayOptions,
	formatInterviewLine,
	normalizeInterview,
	summarizeAnswers,
	type InterviewAnswer,
	type InterviewDetails,
	type NormalizedQuestion,
	type NormalizedWave,
	type SelectAnswer,
} from "./_types.ts";
import { parseDigitKey, selectionFromCustom, selectionFromIndex, toggleIndex, withNote } from "./_logic.ts";

interface QuestionSession {
	q: NormalizedQuestion;
	opts: ReturnType<typeof buildDisplayOptions>;
	optionIndex: number;
	answer: SelectAnswer | null; // recorded single-select answer
	multi: Set<number>;
	customEntry: SelectAnswer | null;
	noteText: string;
}

interface RecordedAnswer extends InterviewAnswer {}

interface ChunkUIResult {
	answers: RecordedAnswer[];
	cancelled: boolean;
}

function buildSession(q: NormalizedQuestion): QuestionSession {
	return {
		q,
		opts: buildDisplayOptions(q),
		optionIndex: 0,
		answer: null,
		multi: new Set(),
		customEntry: null,
		noteText: "",
	};
}

/** A single sequential questionnaire: one wave of questions, respected in full. */
interface WaveChunk {
	waveLabel?: string;
	questions: NormalizedQuestion[];
	/** 1-based position of this questionnaire in the whole interview */
	position: number;
	/** Total number of questionnaires in the whole interview */
	total: number;
}

/**
 * Each wave becomes one sequential questionnaire, respected in full — no
 * splitting, whatever the question count. A flat list is a single wave.
 */
function buildChunks(waves: NormalizedWave[]): WaveChunk[] {
	const chunks: WaveChunk[] = waves.map((wave) => ({
		waveLabel: wave.label,
		questions: wave.questions,
		position: 0,
		total: 0,
	}));
	chunks.forEach((c, i) => {
		c.position = i + 1;
		c.total = chunks.length;
	});
	return chunks;
}

/**
 * The `interview` tool definition registered by the extension.
 */
export function createInterviewTool(): ToolDefinition<typeof InterviewParams, InterviewDetails> {
	return {
		name: "interview",
		label: "Interview",
		description:
			"Ask the user a structured set of questions (interview). The caller controls the structure via `waves`: each wave is a labelled group of questions with any length (hierarchical/structural criteria decide the grouping), executed as a sequential questionnaire — respected in full, never split. Each question supports options, custom answers and notes; a review tab shows all answers before submission. Use for questionnaires, requirements gathering, or multi-wave studies.",
		parameters: InterviewParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { title, waves } = normalizeInterview(params);
			const chunks = buildChunks(waves);

			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { title, waves, answers: [], cancelled: true } as InterviewDetails,
				};
			}

			if (chunks.length === 0 || chunks.every((c) => c.questions.length === 0 || c.questions.every((q) => q.options.length === 0))) {
				return {
					content: [{ type: "text", text: "Error: No questions provided" }],
					details: { title, waves, answers: [], cancelled: true } as InterviewDetails,
				};
			}

			const allAnswers: RecordedAnswer[] = [];
			let cancelled = false;

			// Run each questionnaire sequentially: the next chunk starts only
			// after the user confirms the previous one.
			for (const chunk of chunks) {
				const result = await ctx.ui.custom<ChunkUIResult>((tui, theme, _kb, done) => {
					const flat = chunk.questions;
					const sessions = new Map<string, QuestionSession>();
					for (const q of flat) sessions.set(q.id, buildSession(q));
					const order = flat.map((q) => q.id);

					let currentTab = 0; // 0..order.length-1 questions, order.length = review
					let editMode = false;
					let noteMode = false;
					let cachedLines: string[] | undefined;

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					function currentSession(): QuestionSession | undefined {
						if (currentTab >= order.length) return undefined;
						return sessions.get(order[currentTab]);
					}

					function answersFor(s: QuestionSession): SelectAnswer[] {
						const out: SelectAnswer[] = [];
						const ordered = [...s.multi].sort((a, b) => a - b);
						for (const i of ordered) {
							const opt = s.opts[i];
							if (opt && !opt.isOther) out.push(selectionFromIndex(s.opts, i));
						}
						if (s.customEntry) out.push(s.customEntry);
						if (out.length === 0 && s.answer) out.push(s.answer);
						return out.map((a) => withNote(a, s.noteText));
					}

					function isAnswered(s: QuestionSession): boolean {
						if (s.q.multiSelect) return s.multi.size > 0 || s.customEntry !== null;
						return s.answer !== null;
					}

					function recorded(): RecordedAnswer[] {
						const out: RecordedAnswer[] = [];
						for (const q of flat) {
							const s = sessions.get(q.id)!;
							if (!isAnswered(s)) continue;
							out.push({
								questionId: q.id,
								questionLabel: q.label,
								...(chunk.waveLabel ? { waveLabel: chunk.waveLabel } : {}),
								answers: answersFor(s),
							});
						}
						return out;
					}

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					function advance() {
						if (currentTab < order.length - 1) {
							currentTab++;
						} else {
							currentTab = order.length; // review tab
						}
						refresh();
					}

					function applyAnswers(s: QuestionSession, answers: SelectAnswer[]) {
						if (s.q.multiSelect) {
							s.multi = new Set();
							s.customEntry = null;
						} else {
							s.answer = null;
						}
						// Rebuild state from the submitted answers so back-navigation
						// shows exactly what was recorded.
						for (const a of answers) {
							if (s.q.multiSelect) {
								if (a.wasCustom) s.customEntry = a;
								else if (a.index !== undefined) s.multi.add(a.index - 1);
							} else {
								s.answer = a;
							}
						}
						s.noteText = answers[0]?.note ?? "";
					}

					/**
					 * Record the answers and move to the next tab — on the last
					 * question this lands on the review tab (digit and Enter flow).
					 */
					function recordAndAdvance(s: QuestionSession, answers: SelectAnswer[]) {
						applyAnswers(s, answers);
						advance();
					}

					editor.onSubmit = (value) => {
						const s = currentSession();
						if (editMode && s) {
							const custom = selectionFromCustom(value);
							if (!custom.label) return; // empty → stay in editor
							editMode = false;
							editor.setText("");
							recordAndAdvance(s, [withNote(custom, s.noteText)]);
						} else if (noteMode && s) {
							s.noteText = value.trim();
							noteMode = false;
							editor.setText("");
							refresh();
						}
					};

					function openNoteEditor() {
						noteMode = true;
						editor.setText("");
						refresh();
					}

					/**
					 * Move the highlight. "Type something." enters write mode when
					 * highlighted and leaves it (clearing the field) when it loses
					 * the highlight.
					 */
					function moveCursor(s: QuestionSession, index: number) {
						s.optionIndex = index;
						editMode = s.opts[index]?.isOther === true;
						editor.setText("");
						refresh();
					}

					function recordSelection(s: QuestionSession, index: number) {
						const opt = s.opts[index];
						if (opt.isOther) {
							moveCursor(s, index); // auto write mode
							return;
						}
						if (s.q.multiSelect) {
							s.multi = toggleIndex(s.multi, index);
							s.optionIndex = index;
							refresh();
							return;
						}
						recordAndAdvance(s, [withNote(selectionFromIndex(s.opts, index), s.noteText)]);
					}

					function handleInput(data: string) {
						if (noteMode) {
							if (matchesKey(data, Key.escape)) {
								noteMode = false;
								editor.setText("");
								refresh();
							} else {
								editor.handleInput(data);
								refresh();
							}
							return;
						}

						const s = currentSession();
						const totalTabs = order.length + 1;

						if (editMode && s) {
							if (matchesKey(data, Key.escape)) {
								editMode = false;
								editor.setText("");
								moveCursor(s, Math.max(0, s.optionIndex - 1));
								return;
							}
							if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
								const next = matchesKey(data, Key.up)
									? Math.max(0, s.optionIndex - 1)
									: Math.min(s.opts.length - 1, s.optionIndex + 1);
								editMode = false;
								editor.setText("");
								moveCursor(s, next);
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}

						// Tab navigation (always available outside editors)
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							refresh();
							return;
						}

						// Review tab
						if (currentTab === order.length) {
							if (matchesKey(data, Key.enter) && recorded().length === flat.length) {
								done({ answers: recorded(), cancelled: false });
							} else if (matchesKey(data, Key.escape)) {
								currentTab = Math.max(0, order.length - 1);
								refresh();
							}
							return;
						}

						if (!s) return;

						const digit = parseDigitKey(data);
						if (digit !== null && digit < s.opts.length) {
							recordSelection(s, digit);
							return;
						}

						if (matchesKey(data, Key.up)) {
							moveCursor(s, Math.max(0, s.optionIndex - 1));
							return;
						}
						if (matchesKey(data, Key.down)) {
							moveCursor(s, Math.min(s.opts.length - 1, s.optionIndex + 1));
							return;
						}

						if (matchesKey(data, Key.space) && s.q.multiSelect) {
							recordSelection(s, s.optionIndex);
							return;
						}

						if (matchesKey(data, "n") && s.q.allowNote) {
							openNoteEditor();
							return;
						}

						if (matchesKey(data, Key.enter)) {
							if (s.q.multiSelect) {
								if (s.multi.size > 0 || s.customEntry) {
									recordAndAdvance(s, answersFor(s));
								}
							} else if (s.opts[s.optionIndex]?.isOther) {
								moveCursor(s, s.optionIndex); // ensure write mode
							} else {
								recordAndAdvance(s, [withNote(selectionFromIndex(s.opts, s.optionIndex), s.noteText)]);
							}
							return;
						}

						if (matchesKey(data, Key.escape)) {
							if (currentTab > 0) {
								currentTab--;
								refresh();
							} else {
								done({ answers: recorded(), cancelled: true });
							}
						}
					}

					function render(width: number): string[] {
						if (cachedLines) return cachedLines;

						const lines: string[] = [];
						const renderWidth = Math.max(1, width);

						function addWrapped(text: string) {
							lines.push(...wrapTextWithAnsi(text, renderWidth));
						}

						function addWrappedWithPrefix(prefix: string, text: string) {
							const prefixWidth = visibleWidth(prefix);
							if (prefixWidth >= renderWidth) {
								addWrapped(prefix + text);
								return;
							}
							const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
							const continuationPrefix = " ".repeat(prefixWidth);
							for (let i = 0; i < wrapped.length; i++) {
								lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
							}
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));

						// Header: title + wave + questionnaire progress + tab bar
						const headerBits: string[] = [];
						if (title) headerBits.push(title);
						if (chunk.waveLabel) headerBits.push(theme.fg("accent", theme.bold(chunk.waveLabel)));
						if (chunk.total > 1) headerBits.push(theme.fg("muted", `Questionnaire ${chunk.position}/${chunk.total}`));
						if (headerBits.length > 0) {
							addWrappedWithPrefix(" ", headerBits.join(" — "));
							lines.push("");
						}
						const tabs: string[] = ["← "];
						for (let i = 0; i < flat.length; i++) {
							const isActive = i === currentTab;
							const answered = isAnswered(sessions.get(flat[i].id)!);
							const box = answered ? "■" : "□";
							const color = answered ? "success" : "muted";
							const text = ` ${box} ${flat[i].label} `;
							const styled = isActive ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(color, text);
							tabs.push(`${styled} `);
						}
						const canSubmit = recorded().length === flat.length;
						const isSubmitTab = currentTab === order.length;
						const submitText = " ✓ Submit ";
						const submitStyled = isSubmitTab
							? theme.bg("selectedBg", theme.fg("text", submitText))
							: theme.fg(canSubmit ? "success" : "dim", submitText);
						tabs.push(`${submitStyled} →`);
						addWrappedWithPrefix(" ", tabs.join(""));
						lines.push("");

						// Review tab
						if (currentTab === order.length) {
							addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Ready to submit")));
							lines.push("");
							const rec = recorded();
							if (rec.length === 0) {
								addWrappedWithPrefix(" ", theme.fg("muted", "No answers yet."));
							}
							for (const r of rec) {
								addWrappedWithPrefix(
									" ",
									theme.fg("muted", `${r.questionLabel}: `) + theme.fg("text", summarizeAnswers(r.answers)),
								);
							}
							lines.push("");
							if (canSubmit) {
								const nextLabel = chunk.position < chunk.total ? " next questionnaire" : "";
								addWrappedWithPrefix(" ", theme.fg("success", `Press Enter to submit${nextLabel}`));
							} else {
								const missing = flat.filter((q) => !isAnswered(sessions.get(q.id)!)).map((q) => q.label).join(", ");
								addWrappedWithPrefix(" ", theme.fg("warning", `Unanswered: ${missing}`));
							}
							addWrappedWithPrefix(" ", theme.fg("dim", "Tab to go back and edit • Esc to previous question"));
							lines.push(theme.fg("accent", "─".repeat(renderWidth)));
							cachedLines = lines;
							return lines;
						}

						// Question tab
						const s = currentSession()!;
						addWrappedWithPrefix(" ", theme.fg("text", s.q.prompt));
						lines.push("");

						function renderOptions() {
							for (let i = 0; i < s.opts.length; i++) {
								const opt = s.opts[i];
								const isOther = opt.isOther === true;
								const navigated = i === s.optionIndex;
								const editorOpen = isOther && editMode;

								let prefix: string;
								let color: ThemeColor;

								if (s.q.multiSelect) {
									const checked = s.multi.has(i);
									const mark = checked ? "[x] " : "[ ] ";
									prefix = navigated ? theme.fg("accent", `> ${mark}`) : theme.fg("dim", `  ${mark}`);
									color = checked ? "success" : navigated ? "accent" : "text";
								} else {
									const recordedAnswer = s.answer && !s.answer.wasCustom && s.answer.index === i + 1;
									if (recordedAnswer) {
										prefix = theme.fg("accent", "> ✓ ");
										color = "success";
									} else {
										prefix = navigated ? theme.fg("accent", "> ") : "  ";
										color = navigated || editorOpen ? "accent" : "text";
									}
								}

								const label = `${i + 1}. ${opt.label}${editorOpen ? " ✎" : ""}`;
								addWrappedWithPrefix(prefix, theme.fg(color, label));
								if (opt.description) {
									addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
								}
							}
						}

						renderOptions();

						// Recorded custom answer
						if (s.answer?.wasCustom) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("success", "✎ ") + theme.fg("text", s.answer.label));
						}
						if (s.q.multiSelect && s.customEntry) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("success", "✎ ") + theme.fg("text", s.customEntry.label));
						}

						if (s.noteText) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", `note: ${s.noteText} (attached to your answer)`));
						}

						if (editMode) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) {
								lines.push(` ${line}`);
							}
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
						} else if (noteMode) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", "Note (optional, attached to your answer):"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) {
								lines.push(` ${line}`);
							}
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("dim", "Enter to arm note • Esc to skip"));
						} else {
							lines.push("");
							const progress = `${currentTab + 1}/${flat.length}`;
							if (s.q.multiSelect) {
								addWrappedWithPrefix(" ", theme.fg("dim", `${progress} • ←→ tabs • ↑↓/1-9 move • Space toggle • Enter next • n note • Esc back`));
							} else {
								addWrappedWithPrefix(" ", theme.fg("dim", `${progress} • ←→ tabs • ↑↓ move • 1-9 answer • Enter next${s.q.allowNote ? " • n note" : ""} • Esc back`));
							}
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));

						cachedLines = lines;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				});

				allAnswers.push(...result.answers);
				if (result.cancelled) {
					cancelled = true;
					break;
				}
			}

			const details: InterviewDetails = {
				title,
				waves,
				answers: allAnswers,
				cancelled,
			};

			if (cancelled || allAnswers.length === 0) {
				return {
					content: [{ type: "text", text: "User cancelled the interview" }],
					details,
				};
			}

			const content = allAnswers
				.map((r) => {
					const line = formatInterviewLine(r.questionLabel, r.answers);
					return r.waveLabel ? `${r.waveLabel} · ${line}` : line;
				})
				.join("\n");
			return { content: [{ type: "text", text: content }], details };
		},

		renderCall(args, theme, _context) {
			const waves = Array.isArray(args.waves) ? args.waves : [];
			const questions = Array.isArray(args.questions) ? args.questions : [];
			const count = waves.reduce((n, w) => n + (Array.isArray(w.questions) ? w.questions.length : 0), 0) || questions.length;
			const waveCount = waves.length;
			let text = theme.fg("toolTitle", theme.bold("interview "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (waveCount > 1) text += theme.fg("dim", ` in ${waveCount} waves`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as InterviewDetails | undefined;
			if (!details) return new Text("", 0, 0);
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			const lines = details.answers.map((a) => {
				const label = a.waveLabel ? `${a.waveLabel} · ${a.questionLabel}` : a.questionLabel;
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", label)}: ${summarizeAnswers(a.answers)}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	};
}
