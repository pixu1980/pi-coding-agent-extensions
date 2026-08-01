/**
 * pi-ask — `/ask` and `/ask-interview` commands + keyword auto-trigger
 *
 * `/ask <topic>`          — single-question mode: instructs the model to use
 *                           the `ask` tool (one question, options + custom
 *                           answer + note, optional multi-select).
 * `/ask-interview <topic>` — interview mode: instructs the model to use the
 *                           `interview` tool for a structured set of
 *                           questions, optionally split into multiple waves.
 *
 * Auto-trigger: the `input` event watches for natural-language keyword
 * phrases ("fammi una domanda", "intervistami", "questionario", ...) and
 * routes the message into ask/interview mode automatically, so the user
 * does not have to type the slash command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Prompts ────────────────────────────────────────────────────────────────

function askPrompt(topic: string): string {
	return `Single-question mode: ask the user exactly ONE question about: ${topic}

Use the "ask" tool (options + custom answer + optional note). Provide 3-5 clear, distinct options. Use multiSelect only when several choices can coexist. If the user cancels, rephrase or continue with what you have — never loop. After the answer, summarize in one or two lines and proceed with the task.

Start now with your question.`;
}

function interviewPrompt(topic: string): string {
	return `Interview mode: gather structured input from the developer about: ${topic}

Use the "interview" tool to ask a structured set of questions. Split the questions into multiple labelled waves when the topic spans phases (e.g. "Wave 1 — Baseline" and "Wave 2 — Follow-up" for a two-wave study); group questions by hierarchical or structural criteria (sections, difficulty, phases) and let each wave carry any number of questions. Provide 3-5 clear options per question; use multiSelect only when several choices can coexist. If the user cancels a question, rephrase or continue with what you have — never loop. After the answers, summarize in one or two lines and proceed with the task.

Start now with your first wave/question.`;
}

// ── Keyword auto-trigger ───────────────────────────────────────────────────

/**
 * Phrases that signal the user wants to be asked a single question
 * (e.g. "fammi una domanda", "ask me something").
 */
const ASK_KEYWORDS = [
	"fammi una domanda",
	"fai una domanda",
	"fammi qualche domanda",
	"una domanda sola",
	"domanda singola",
	"chiedimi qualcosa",
	"chiedimi una cosa",
	"fammi un quiz",
	"chiedimi",
	"ask me a question",
	"ask me something",
	"ask me one question",
	"single question",
	"quiz me",
	"one question for me",
];

/**
 * Phrases that signal the user wants a structured interview / questionnaire
 * (e.g. "intervistami", "fammi un questionario", "two waves of questions").
 */
const INTERVIEW_KEYWORDS = [
	"intervistami",
	"fammi un'intervista",
	"fammi una intervista",
	"fammi un questionario",
	"fammi il questionario",
	"questionario",
	"questionari",
	"intervista",
	"serie di domande",
	"set di domande",
	"batteria di domande",
	"più domande",
	"piu domande",
	"domande strutturate",
	"più wave",
	"piu wave",
	"due wave",
	"2 wave",
	"n wave",
	"due ondate",
	"interview me",
	"questionnaire",
	"questionnaires",
	"a survey",
	"series of questions",
	"set of questions",
	"multiple waves",
	"two waves",
	"structured questions",
];

export function registerAskCommands(pi: ExtensionAPI) {
	pi.registerCommand("ask", {
		description: "Ask the user a single question (options, custom answer, note)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ask requires interactive mode", "error");
				return;
			}
			const topic = (args ?? "").trim() || "the current task";
			await pi.sendUserMessage(askPrompt(topic), { deliverAs: "followUp" });
		},
	});

	pi.registerCommand("ask-interview", {
		description: "Run a structured interview / questionnaire (multiple questions, optional waves)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ask-interview requires interactive mode", "error");
				return;
			}
			const topic = (args ?? "").trim() || "the current task";
			await pi.sendUserMessage(interviewPrompt(topic), { deliverAs: "followUp" });
		},
	});
}

/**
 * Watch interactive input for natural-language ask/interview phrases and
 * route the message into the matching mode automatically.
 */
export function registerAskAutoTrigger(pi: ExtensionAPI) {
	pi.on("input", async (event) => {
		if (event.source !== "interactive") return { action: "continue" };
		const text = (event.text ?? "").trim();
		if (!text || text.startsWith("/")) return { action: "continue" };

		const lower = text.toLowerCase();
		const interviewHit = INTERVIEW_KEYWORDS.find((k) => lower.includes(k));
		if (interviewHit) {
			await pi.sendUserMessage(interviewPrompt(text), { deliverAs: "followUp" });
			return { action: "handled" };
		}
		const askHit = ASK_KEYWORDS.find((k) => lower.includes(k));
		if (askHit) {
			await pi.sendUserMessage(askPrompt(text), { deliverAs: "followUp" });
			return { action: "handled" };
		}
		return { action: "continue" };
	});
}

// ── Guardrails (system-prompt level) ───────────────────────────────────────

/**
 * Imperative directive appended to the system prompt when the user's prompt
 * signals a structured interview. Lives in the system prompt, so the model
 * cannot "forget" to use the tool.
 */
const INTERVIEW_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail)\nThe user's message requests a structured interview/questionnaire. You MUST call the \`interview\` tool before writing any other text — do not reply with plain-text questions. Split the questions into labelled waves when the topic spans phases (e.g. "Wave 1 — Baseline" and "Wave 2 — Follow-up"); group by hierarchical or structural criteria and let each wave carry any number of questions. Provide 3-5 clear options per question; use multiSelect only when several choices can coexist. If the user cancels, rephrase or continue with what you have — never loop.`;

/**
 * Imperative directive appended to the system prompt when the user's prompt
 * signals a single question.
 */
const ASK_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail)\nThe user's message requests a single question. You MUST call the \`ask\` tool before writing any other text — do not reply with a plain-text question. Provide 3-5 clear, distinct options; use multiSelect only when several choices can coexist. If the user cancels, rephrase or continue with what you have — never loop.`;

function findMatch(text: string): { kind: "interview" | "ask"; keyword: string } | null {
	const lower = text.toLowerCase();
	const interviewHit = INTERVIEW_KEYWORDS.find((k) => lower.includes(k));
	if (interviewHit) return { kind: "interview", keyword: interviewHit };
	const askHit = ASK_KEYWORDS.find((k) => lower.includes(k));
	if (askHit) return { kind: "ask", keyword: askHit };
	return null;
}

/**
 * System-prompt guardrail: whenever the user's prompt signals ask/interview
 * intent, append a mandatory directive so the model is forced to use the
 * pi-ask tool. Runs on every agent start; only active when this extension
 * (pi-ask) is installed.
 */
export function registerAskGuardrails(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const prompt = (event.prompt ?? "").trim();
		if (!prompt || prompt.startsWith("/")) return;
		const match = findMatch(prompt);
		if (!match) return;
		const guardrail = match.kind === "interview" ? INTERVIEW_GUARDRAIL : ASK_GUARDRAIL;
		return { systemPrompt: `${event.systemPrompt}${guardrail}` };
	});
}
