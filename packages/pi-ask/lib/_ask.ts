/**
 * pi-ask — `ask` tool (single question)
 *
 * Full custom UI: highlighted option + Enter confirms; "Type something."
 * enters write mode as soon as it is highlighted (cleared when it loses
 * focus); `n` opens the note editor for the next confirmed answer; digits
 * 1-9/0 quick-submit; multi-select toggles with Space and confirms with
 * Enter.
 *
 * Escape closes editors first, then cancels.
 */

import type { ThemeColor, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
	AskParams,
	OTHER_LABEL,
	buildDisplayOptions,
	formatSelectionAnswer,
	normalizeOptions,
	summarizeAnswers,
	type AskDetails,
	type DisplayOption,
	type SelectAnswer,
} from "./_types.ts";
import { parseDigitKey, selectionFromCustom, selectionFromIndex, toggleIndex, withNote } from "./_logic.ts";

interface AskState {
	optionIndex: number;
	editMode: boolean; // "Type something." write mode (auto when highlighted)
	noteMode: boolean; // note editor open
	noteText: string; // armed note, attached to the confirmed answer
	multi: Set<number>;
	customEntry: SelectAnswer | null; // custom answer in multi-select mode
}

/**
 * The `ask` tool definition registered by the extension.
 */
export function createAskTool(): ToolDefinition<typeof AskParams, AskDetails> {
	return {
		name: "ask",
		label: "Ask",
		description:
			"Ask the user a single question and let them pick from options, type a custom answer, or attach a note. Use when you need a decision, preference, or confirmation to proceed.",
		parameters: AskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const options = normalizeOptions(params.options);
			const multi = params.multiSelect === true;
			const allowNote = params.allowNote !== false;

			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: {
						question: params.question,
						options: options.map((o) => o.label),
						answer: null,
						selections: null,
						cancelled: true,
					} as AskDetails,
				};
			}

			if (options.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No options provided" }],
					details: {
						question: params.question,
						options: [],
						answer: null,
						selections: null,
						cancelled: true,
					} as AskDetails,
				};
			}

			const displayOptions = buildDisplayOptions({
				id: "ask",
				label: "Q",
				prompt: params.question,
				options,
				allowOther: params.allowOther !== false,
				multiSelect: multi,
				allowNote,
			});

			const result = await ctx.ui.custom<{ answers: SelectAnswer[]; cancelled: boolean }>((tui, theme, _kb, done) => {
				const state: AskState = {
					optionIndex: 0,
					editMode: false,
					noteMode: false,
					noteText: "",
					multi: new Set(),
					customEntry: null,
				};
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

				editor.onSubmit = (value) => {
					if (state.editMode) {
						const custom = selectionFromCustom(value);
						if (!custom.label) return; // empty → stay in editor
						state.editMode = false;
						editor.setText("");
						if (multi) {
							state.customEntry = custom;
							refresh();
						} else {
							submit([custom]);
						}
					} else if (state.noteMode) {
						state.noteText = value.trim();
						state.noteMode = false;
						editor.setText("");
						refresh();
					}
				};

				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function submit(answers: SelectAnswer[]) {
					done({ answers: answers.map((a) => withNote(a, state.noteText)), cancelled: false });
				}

				/**
				 * Move the highlight. When "Type something." becomes the
				 * highlighted option it enters write mode; when it loses the
				 * highlight the write mode closes and the field clears.
				 */
				function moveCursor(index: number) {
					state.optionIndex = index;
					state.editMode = displayOptions[index]?.isOther === true;
					editor.setText("");
					refresh();
				}

				function submitOption(index: number) {
					const opt = displayOptions[index];
					if (multi) {
						state.multi = toggleIndex(state.multi, index);
						state.optionIndex = index;
						refresh();
					} else {
						submit([selectionFromIndex(displayOptions, index)]);
					}
				}

				function submitAll() {
					const answers: SelectAnswer[] = [];
					const ordered = [...state.multi].sort((a, b) => a - b);
					for (const i of ordered) {
						const opt = displayOptions[i];
						if (opt && !opt.isOther) answers.push(selectionFromIndex(displayOptions, i));
					}
					if (state.customEntry) answers.push(state.customEntry);
					if (answers.length > 0) submit(answers);
				}

				function handleInput(data: string) {
					if (state.noteMode) {
						if (matchesKey(data, Key.escape)) {
							state.noteMode = false;
							editor.setText("");
							refresh();
						} else {
							editor.handleInput(data);
							refresh();
						}
						return;
					}

					if (state.editMode) {
						if (matchesKey(data, Key.escape)) {
							// exit write mode and move off "Type something." so it
							// does not immediately re-enter
							state.editMode = false;
							editor.setText("");
							moveCursor(Math.max(0, state.optionIndex - 1));
							return;
						}
						if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
							const next = matchesKey(data, Key.up)
								? Math.max(0, state.optionIndex - 1)
								: Math.min(displayOptions.length - 1, state.optionIndex + 1);
							// loses highlight → write mode closes, field clears
							state.editMode = false;
							editor.setText("");
							moveCursor(next);
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const digit = parseDigitKey(data);
					if (digit !== null && digit < displayOptions.length) {
						const opt = displayOptions[digit];
						if (!multi && opt.isOther) {
							moveCursor(digit); // auto write mode
						} else {
							submitOption(digit);
						}
						return;
					}

					if (matchesKey(data, Key.up)) {
						moveCursor(Math.max(0, state.optionIndex - 1));
						return;
					}
					if (matchesKey(data, Key.down)) {
						moveCursor(Math.min(displayOptions.length - 1, state.optionIndex + 1));
						return;
					}

					if (matchesKey(data, Key.enter)) {
						if (multi) {
							submitAll();
						} else if (displayOptions[state.optionIndex]?.isOther) {
							moveCursor(state.optionIndex); // ensure write mode
						} else {
							submit([selectionFromIndex(displayOptions, state.optionIndex)]);
						}
						return;
					}

					if (multi && matchesKey(data, Key.space)) {
						submitOption(state.optionIndex);
						return;
					}

					if (matchesKey(data, "n") && allowNote && !state.editMode) {
						state.noteMode = true;
						editor.setText(state.noteText);
						refresh();
						return;
					}

					if (matchesKey(data, Key.escape)) {
						if (multi && (state.multi.size > 0 || state.customEntry)) {
							state.multi = new Set();
							state.customEntry = null;
							refresh();
							return;
						}
						done({ answers: [], cancelled: true });
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
					addWrappedWithPrefix(" ", theme.fg("text", params.question));
					lines.push("");

					for (let i = 0; i < displayOptions.length; i++) {
						const opt = displayOptions[i];
						const isOther = opt.isOther === true;
						const navigated = i === state.optionIndex;

						let prefix: string;
						let color: ThemeColor;

						if (multi) {
							const checked = state.multi.has(i);
							const mark = checked ? "[x] " : "[ ] ";
							prefix = navigated ? theme.fg("accent", `> ${mark}`) : theme.fg("dim", `  ${mark}`);
							color = checked ? "success" : navigated ? "accent" : "text";
						} else {
							prefix = navigated ? theme.fg("accent", "> ") : "  ";
							color = navigated ? "accent" : "text";
						}

						const label = `${i + 1}. ${opt.label}${isOther && state.editMode ? " ✎" : ""}`;
						addWrappedWithPrefix(prefix, theme.fg(color, label));
						if (opt.description) {
							addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
						}
					}

					// Custom answer entry (multi-select)
					if (multi && state.customEntry) {
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("success", "✎ ") + theme.fg("text", state.customEntry.label));
					}

					// Armed note
					if (state.noteText) {
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("muted", `note: ${state.noteText} (attached to your answer)`));
					}

					// Editors
					if (state.editMode) {
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
						for (const line of editor.render(Math.max(1, renderWidth - 2))) {
							lines.push(` ${line}`);
						}
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • ↑↓/Esc to leave"));
					} else if (state.noteMode) {
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("muted", "Note (optional, attached to your answer):"));
						for (const line of editor.render(Math.max(1, renderWidth - 2))) {
							lines.push(` ${line}`);
						}
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("dim", "Enter to arm note • Esc to skip"));
					} else {
						lines.push("");
						if (multi) {
							const hint = "↑↓/1-9 move • Space toggle • Enter submit • n note • Esc clear/cancel";
							addWrappedWithPrefix(" ", theme.fg("dim", hint));
						} else {
							const hint = `↑↓/1-9 move • Enter confirm${allowNote ? " • n note" : ""} • Esc cancel`;
							addWrappedWithPrefix(" ", theme.fg("dim", hint));
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

			const details: AskDetails = {
				question: params.question,
				options: options.map((o) => o.label),
				answer: multi ? null : result.answers[0] ?? null,
				selections: multi ? (result.answers.length > 0 ? result.answers : null) : null,
				cancelled: result.cancelled,
			};

			if (result.cancelled || result.answers.length === 0) {
				return {
					content: [{ type: "text", text: "User cancelled the question" }],
					details,
				};
			}

			const text = multi ? `User selected: ${summarizeAnswers(result.answers)}` : `User answered: ${formatSelectionAnswer(result.answers[0])}`;
			return { content: [{ type: "text", text }], details };
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("ask ")) + theme.fg("muted", args.question);
			const opts = Array.isArray(args.options) ? args.options : [];
			if (opts.length) {
				const labels = opts.map((o) => o.label);
				const numbered = [...labels, OTHER_LABEL].map((o, i) => `${i + 1}. ${o}`);
				text += `\n${theme.fg("dim", `  Options: ${numbered.join(", ")}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as AskDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			if (details.answer) {
				const label = formatSelectionAnswer(details.answer);
				return new Text(theme.fg("success", "✓ ") + theme.fg("accent", label), 0, 0);
			}
			if (details.selections?.length) {
				const label = summarizeAnswers(details.selections);
				return new Text(theme.fg("success", "✓ ") + theme.fg("accent", label), 0, 0);
			}
			return new Text(theme.fg("warning", "No answer"), 0, 0);
		},
	};
}
