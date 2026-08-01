---
name: interview
description: Use when you need to ask the developer questions — gathering requirements, preferences, or confirming decisions. Use the `ask` and `questionnaire` tools so the user answers interactively with number keys, custom answers, or notes.
---

# Interview Mode

When you need input from the developer, use the interactive question tools
(`ask`, `questionnaire`) instead of typing plain questions in your reply.
The tools render a full-screen picker in the terminal: the developer picks an
option with a number key or the arrow keys, can attach a note with `n`, or type
a custom answer.

## When to use which tool

| Situation | Tool |
|---|---|
| One decision, preference, or confirmation | `ask` |
| Several related questions (config setup, requirements gathering) | `questionnaire` (≤ 5-6 questions per call) |
| Multiple simultaneous choices (e.g. "which features?") | `ask` with `multiSelect: true`, or a `multiSelect` question in `questionnaire` |

## Rules

1. **Ask one thing at a time.** One clear question per `ask` call. Do not bundle
   unrelated decisions into a single question.
2. **Provide 3-5 distinct options.** Keep labels short and scannable. Add an
   optional `description` when an option needs context.
3. **Let the user go off-script.** Options are a starting point — the user can
   always type a custom answer (`Type something.`). Expect that and adapt.
4. **Notes carry context.** Users may attach a note to an answer (`n`). Read it
   carefully; it often contains the real constraint.
5. **Handle cancellation gracefully.** If the user cancels a question, rephrase,
   offer fewer options, or continue with what you already know. Never loop on
   the same question.
6. **Multi-select sparingly.** Only enable `multiSelect` when several choices
   genuinely coexist (languages, features, priorities). Single-select is the
   default for a reason.
7. **Summarize and move on.** After the answers, briefly confirm what you
   understood (one or two lines) and continue the task. Do not re-ask what was
   already answered.
8. **Sequential execution.** These tools replace the editor; run them one at a
   time, not in parallel with other tools.

## Example flow (requirements gathering)

1. `ask` — "What type of app are we building?" → Web / CLI / Library / Desktop
2. `ask` — "Which language?" → TypeScript / Rust / Go / Python
3. `questionnaire` — 3 quick questions about tooling, deployment, and deadline
4. Confirm: "Got it: a web app in TypeScript, deployed to Vercel, shipping next
   week." Then start working.
