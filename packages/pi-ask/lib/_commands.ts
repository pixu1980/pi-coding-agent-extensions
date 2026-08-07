/**
 * pi-ask - `/ask` and `/ask-interview` commands + keyword auto-trigger
 *
 * `/ask <topic>`          - single-question mode: instructs the model to use
 *                           the `ask` tool (one question, options + custom
 *                           answer + note, optional multi-select). Also
 *                           covers sharp interviews: when the user asks to
 *                           challenge a plan, the model walks the design
 *                           tree one question at a time with recommended
 *                           answers and codebase exploration.
 * `/ask-interview <topic>` - interview mode: instructs the model to use the
 *                           `interview` tool for a structured set of
 *                           questions, optionally split into waves. With the
 *                           "con dominio" / `--docs` variant it also
 *                           stress-tests the plan against CONTEXT.md
 *                           glossary, ADRs and the code.
 *
 * Auto-trigger: the `input` event watches for natural-language keyword
 * phrases ("fammi una domanda", "intervistami", "sfida il piano", "contro il
 * dominio", ...) and routes the message into ask/interview mode
 * automatically, so the user does not have to type the slash command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── CONTEXT.md / ADR formats ───────────────────────────────────────────────

const CONTEXT_FORMAT = `# CONTEXT.md Format

\\\`\\\`\\\`md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A concise description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

## Relationships

- An **Order** produces one or more **Invoices**
- An **Invoice** belongs to exactly one **Customer**

## Example dialogue

> **Dev:** "When a **Customer** places an **Order**, do we create the **Invoice** immediately?"
> **Domain expert:** "No - an **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "account" was used to mean both **Customer** and **User** - resolved: these are distinct concepts.
\\\`\\\`\\\`

Rules: be opinionated (pick the best word, list aliases to avoid); flag conflicts explicitly; keep definitions tight (one sentence, what it IS); show relationships with cardinality; only include context-specific terms; write an example dialogue. Single context: one \\\`CONTEXT.md\\\` at the root. Multiple contexts: a \\\`CONTEXT-MAP.md\\\` lists each context. Create files lazily.`;

const ADR_FORMAT = `# ADR Format

ADRs live in \\\`docs/adr/\\\` with sequential numbering: \\\`0001-slug.md\\\`, etc.

\\\`\\\`\\\`md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
\\\`\\\`\\\`

Optional sections (only when they add value): Status frontmatter, Considered Options, Consequences. Numbering: scan \\\`docs/adr/\\\` for the highest number and increment.

Offer an ADR only when ALL three hold: (1) hard to reverse, (2) surprising without context, (3) a real trade-off. Otherwise skip.`;

// ── Prompts ────────────────────────────────────────────────────────────────

function askPrompt(topic: string): string {
	return `Single-question mode: ask the user exactly ONE question about: ${topic}

Use the "ask" tool (options + custom answer + optional note). Provide 3-5 clear, distinct options. Use multiSelect only when several choices can coexist. If the user cancels, rephrase or continue with what you have - never loop. After the answer, summarize in one or two lines and proceed with the task.

If the user asks for a sharp interview or to challenge/sharpen a plan/design: walk down each branch of the design tree one question at a time, put your recommended answer first marked "(recommended)", explore the codebase to answer questions yourself, and challenge assumptions directly. Still one question at a time via the "ask" tool.

Start now with your question.`;
}

function interviewPrompt(topic: string, withDocs = false): string {
	const docsBlock = withDocs
		? `

## Domain awareness

Stress-test the plan against the existing domain model. Explore the codebase and existing documentation before and during the session:

- Read \\\`CONTEXT.md\\\` (single context) or \\\`CONTEXT-MAP.md\\\` (multi-context) if present.
- Look for \\\`docs/adr/\\\` (system-wide and per-context).
- Create files lazily - only when you have something to write.

During the session: challenge the user's terms against the CONTEXT.md glossary and call out conflicts immediately; propose a precise canonical term for vague or overloaded language; stress-test domain relationships with concrete edge-case scenarios; cross-reference statements against the code and surface contradictions; update CONTEXT.md inline as terms are resolved; offer ADRs sparingly.

CONTEXT.md format: ${CONTEXT_FORMAT}

ADR format: ${ADR_FORMAT}`
		: "";
	return `Interview mode: gather structured input from the developer about: ${topic}

Use the "interview" tool to ask a structured set of questions. Split the questions into multiple labelled waves when the topic spans phases (e.g. "Wave 1 - Baseline" and "Wave 2 - Follow-up" for a two-wave study); group questions by hierarchical or structural criteria (sections, difficulty, phases) and let each wave carry any number of questions. Provide 3-5 clear options per question; use multiSelect only when several choices can coexist. If the user cancels a question, rephrase or continue with what you have - never loop. After the answers, summarize in one or two lines, list any CONTEXT.md / ADR updates you made, and proceed with the task.${docsBlock}

Start now with your first wave/question.`;
}

// ── Keyword auto-trigger ───────────────────────────────────────────────────

/**
 * Phrases that signal the user wants a single question - including a sharp
 * interview (one question at a time with recommended answers).
 */
const ASK_KEYWORDS = [
	// plain single question
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
	// sharp-interview phrasing (plan-sharpening behaviour, natural language)
	"intervistami sul piano",
	"intervista il mio piano",
	"sfida il piano",
	"sfida il mio piano",
	"stress-test il piano",
	"stress test il piano",
	"metti alla prova il piano",
	"challenge my plan",
	"stress-test my plan",
];

/**
 * Phrases that signal the user wants a structured interview / questionnaire,
 * including the domain-aware variant (CONTEXT.md / ADR).
 */
const INTERVIEW_KEYWORDS = [
	// plain interview / questionnaire
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
	// domain-aware sharp interview (upgrade to docs mode)
	"intervistami col dominio",
	"intervista il piano contro",
	"sfida il piano contro",
	"contro il dominio",
	"contro il domain model",
	"con il glossario",
	"con CONTEXT.md",
	"domain-aware",
];

/** Phrases that upgrade an interview to the domain-aware (docs) mode. */
const DOCS_KEYWORDS = [
	"con dominio",
	"col dominio",
	"domain model",
	"domain-aware",
	"contro il dominio",
	"contro il domain model",
	"con il glossario",
	"con CONTEXT.md",
	"sfida il piano contro",
	"--docs",
];

function wantsDocs(text: string): boolean {
	const lower = text.toLowerCase();
	return DOCS_KEYWORDS.some((k) => lower.includes(k));
}

export function registerAskCommands(pi: ExtensionAPI) {
	pi.registerCommand("ask", {
		description: "Ask the user a single question (options, custom answer, note) - also covers sharp plan interviews",
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
		description: "Run a structured interview / questionnaire (multiple questions, optional waves); append 'con dominio' or --docs for a domain-aware interview (CONTEXT.md / ADR)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ask-interview requires interactive mode", "error");
				return;
			}
			const raw = (args ?? "").trim();
			const withDocs = wantsDocs(raw);
			const topic = raw.replace(/--docs\b/g, "").trim() || "the current task";
			await pi.sendUserMessage(interviewPrompt(topic, withDocs), { deliverAs: "followUp" });
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
			await pi.sendUserMessage(interviewPrompt(text, wantsDocs(text)), { deliverAs: "followUp" });
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
const INTERVIEW_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail)\nThe user's message requests a structured interview/questionnaire. You MUST call the \`interview\` tool before writing any other text - do not reply with plain-text questions. Split the questions into labelled waves when the topic spans phases (e.g. "Wave 1 - Baseline" and "Wave 2 - Follow-up"); group by hierarchical or structural criteria and let each wave carry any number of questions. Provide 3-5 clear options per question; use multiSelect only when several choices can coexist. If the user cancels, rephrase or continue with what you have - never loop.`;

/**
 * Domain-aware variant: appended when the interview prompt signals a
 * sharp interview session against the domain model (CONTEXT.md / ADR).
 */
const INTERVIEW_DOCS_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail - domain-aware)\nThe user's message requests a domain-aware interview. You MUST drive it through the \`interview\` tool, one wave/questionnaire at a time - do not reply with plain-text questions. Challenge the plan against CONTEXT.md glossary and ADRs, explore the codebase to answer questions yourself, sharpen fuzzy terminology, and update CONTEXT.md / ADRs inline as decisions crystallise.`;

/**
 * Imperative directive appended to the system prompt when the user's prompt
 * signals a single question (including sharp interviews).
 */
const ASK_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail)\nThe user's message requests a single question. You MUST call the \`ask\` tool before writing any other text - do not reply with a plain-text question. Provide 3-5 clear, distinct options; use multiSelect only when several choices can coexist. If the user asks for a sharp interview or to challenge a plan, put your recommended answer first marked "(recommended)", explore the codebase to answer questions yourself, and challenge assumptions. If the user cancels, rephrase or continue with what you have - never loop.`;

function findMatch(text: string): { kind: "interview" | "ask"; docs: boolean; keyword: string } | null {
	const lower = text.toLowerCase();
	const interviewHit = INTERVIEW_KEYWORDS.find((k) => lower.includes(k));
	if (interviewHit) return { kind: "interview", docs: wantsDocs(text), keyword: interviewHit };
	const askHit = ASK_KEYWORDS.find((k) => lower.includes(k));
	if (askHit) return { kind: "ask", docs: false, keyword: askHit };
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
		const guardrail =
			match.kind === "interview"
				? match.docs
					? INTERVIEW_DOCS_GUARDRAIL
					: INTERVIEW_GUARDRAIL
				: ASK_GUARDRAIL;
		return { systemPrompt: `${event.systemPrompt}${guardrail}` };
	});
}
