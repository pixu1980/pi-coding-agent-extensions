# Execution Plan - @pixu1980/pi-ask: Claude Code-style interactive questions

Goal (user request): extension for pi-coding-agent that replicates the
multiple-choice / single-answer question system of Claude Code, with the
ability to **add notes** or **specify a custom answer**, to improve the
experience when the agent is in **interview mode** (gathering requirements,
preferences, confirmations).

## Preliminary research (done)

pi already provides the examples `question.ts` and `qna.ts` (plus a
multi-question variant with a tab bar) in `examples/extensions/` of the
pi-coding-agent package:

- `question.ts` - single question: option list (arrow keys ↑↓ only) + "Type something."
  with inline editor. No notes, no quick number keys, no multi-select.
- multi-question variant - tab bar, "Submit" summary tab, "Type something"
  per question. Arrow keys only, no notes, no multi-select.
- `qna.ts` - extracts questions from the last assistant message and loads them into the editor
  ("prompt generator" pattern).

None of these is an installable package and none implements: **number key selection
(1-9)**, **notes attached to answers**, **multi-select**, **editable summary before submit**,
**skill/command for interview mode**. Our extension fills this gap as a publishable
package in the monorepo (following conventions like pi-path-picker).

## Design decisions

| Decision | Value |
|---|---|
| Package name | `@pixu1980/pi-ask` (tools: `ask`, `interview`; command: `/ask-interview`) |
| Keys | 1-9 for quick selection + ↑↓ + Enter; `n` for note; `Space` for multi-select; `Tab/←→` for question navigation; `Esc` cancel |
| Note | After choosing, `n` key opens inline editor → note travels with the answer in `details` |
| Custom answer | "Type something." option with inline editor (like the examples, but reusable) |
| Multi-select | `multiSelect` flag per question: checkbox `[x]/[ ]`, summary with count |
| Final review | Interview: "Submit" tab with summary of all answers, Enter confirms, Tab goes back to edit |
| Non-TUI fallback | In `print`/`rpc`/`json` mode the tool returns the question without an answer (like the examples) |
| Skill | `skills/interview/SKILL.md`: instructs the model to use `ask`/`interview` when asking questions, with guidelines (max options, when to use multiSelect, etc.) |
| Command | `/ask-interview <topic>`: starts interview mode by sending a message to the model instructing it to ask questions one at a time via `ask` |

## Phase 1 - Scaffold + fundamentals (TDD)

- [x] 1. Scaffold `packages/pi-ask/` (package.json with `pi` manifest, peer deps, `pi-package` keyword; index.ts barrel; lib/; __tests__/; README.md; skills/)
- [x] 2. `lib/_types.ts`: TypeBox schemas (`Option`, `Question`, `AskParams`, `InterviewParams`) + TS types + pure helpers (`normalizeQuestions`, `buildAskOptions`, `formatAnswerSummary`)
- [x] 3. Test `__tests__/_types.test.mjs`: schema validation + pure helpers (first fail, then pass)

## Phase 2 - `ask` tool (single question)

- [x] 4. `lib/_ask.ts`: `ctx.ui.custom` component - numbered options (1-9 + arrows), note with `n`, "Type something", optional multi-select, non-TUI fallback
- [x] 5. Tool registration in `index.ts` with compact `renderCall`/`renderResult`
- [x] 6. Test: selection/note/custom/multi logic (separated from UI in `_logic.ts` for testability) + UI test with fake TUI driver (monorepo harness)

## Phase 3 - `interview` tool (multi-question)

- [x] 7. `lib/_interview.ts`: tab bar (questions + Submit), per-question note, per-question custom, per-question multi-select, editable summary
- [x] 8. Tool registration + `renderCall`/`renderResult`
- [x] 9. Test: navigation, answer map, submit/cancel (fake TUI driver, 8 tests)

## Phase 4 - Interview mode

- [x] 10. `skills/interview/SKILL.md` (guidelines for the model: when to use `ask` vs `interview`, how to formulate options)
- [x] 11. Command `/ask-interview <topic>`: message to the model instructing it to ask questions one at a time via `ask`
- [x] 12. Test: skill exists, command registered, prompt sent as followUp (monorepo harness)

## Phase 5 - Polish + docs + release

- [x] 13. Complete README (install, usage, keys, monorepo-style SVG banner)
- [x] 14. Monorepo `test:all` green (7/7 packages, 245 tests) + smoke test with real `pi -e .`
- [x] 15. Bump version + CHANGELOG + tag + publish npm (`node scripts/release.mjs`) - **awaiting user OK**

  > Re-analysis 2026-09-15: the scope this item covered shipped as **0.1.12** (published on npm,
  > CHANGELOG entry dated 2026-08-25), so the work Phases 1-5 produced is released and the item is done.
  >
  > What is *not* released is newer work sitting uncommitted in the tree: the path-completion bridge
  > (`lib/_path-provider.ts` + `__tests__/_path-provider.test.mjs`, both untracked) plus its wiring in
  > `lib/_ask.ts`, `lib/_interview-tool.ts`, `lib/index.ts`, `README.md` and `__tests__/index.test.mjs`.
  > That work is green (`pnpm test` in packages/pi-ask: **101/101**) and consumes the channel contract
  > pi-path-picker already publishes (`pi-path-picker:provider`, `_contract.ts:34`). It would ship as the
  > next patch release, but `scripts/release.mjs` bumps **every** package with changes since its last tag,
  > and the working tree currently also holds unreleased changes in pi-cursor, pi-mcp, pi-path-picker,
  > pi-reasoning, pi-sessions and pi-statusline. Release scope is therefore a user decision, not a
  > mechanical step: publishing now would sweep all of them into one release. Kept open pending that call.

## Out of scope (future candidates)

- Floating overlay (`overlay-qa-tests.ts` pattern) to answer without losing context
- Automatic question extraction from last message (`qna.ts`) as `/qna` command
- Persistent user preferences ("always" / "remember" answers)
