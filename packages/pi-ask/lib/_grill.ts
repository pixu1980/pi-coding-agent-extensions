/**
 * pi-ask — grill mode (`/ask-grill`)
 *
 * A relentless interview that sharpens a plan or design, one question at a
 * time, with a recommended answer per question. Domain-aware variant
 * (formerly `grill-with-docs`) challenges the plan against the existing
 * domain model: CONTEXT.md glossary, ADRs under docs/adr/, and the code
 * itself. This absorbs the `grill-me` and `grill-with-docs` skills so they
 * can be retired.
 *
 * Wired up as:
 *   - `/ask-grill <topic>`          command
 *   - `/ask-grill-docs <topic>`     domain-aware variant
 *   - keyword auto-trigger          "grillami", "grill me", "sfida il piano", ...
 *   - system-prompt guardrail       forces the ask tool during grilling
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── CONTEXT.md / ADR formats (absorbed from grill-with-docs) ───────────────

export const CONTEXT_FORMAT = `# CONTEXT.md Format

## Structure

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
> **Domain expert:** "No — an **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "account" was used to mean both **Customer** and **User** — resolved: these are distinct concepts.
\\\`\\\`\\\`

## Rules

- **Be opinionated.** Pick the best word for a concept and list the others as aliases to avoid.
- **Flag conflicts explicitly.** Call out ambiguous terms in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show relationships.** Bold term names, express cardinality where obvious.
- **Only include terms specific to this project.** General programming concepts don't belong.
- **Write an example dialogue** between a dev and a domain expert.

## Single vs multi-context repos

Single context: one \\\`CONTEXT.md\\\` at the root.
Multiple contexts: a \\\`CONTEXT-MAP.md\\\` at the root lists each context's file and how they relate.
Create files lazily — only when you have something to write.`;

export const ADR_FORMAT = `# ADR Format

ADRs live in \\\`docs/adr/\\\` with sequential numbering: \\\`0001-slug.md\\\`, \\\`0002-slug.md\\\`, etc.

## Template

\\\`\\\`\\\`md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
\\\`\\\`\\\`

## Optional sections (only when they add value)

- **Status** frontmatter (proposed | accepted | deprecated | superseded by ADR-NNNN)
- **Considered Options** — only when rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan \\\`docs/adr/\\\` for the highest existing number and increment by one.

## When to offer an ADR

ALL three must be true:
1. **Hard to reverse** — changing your mind later is costly
2. **Surprising without context** — a future reader will wonder "why?"
3. **A real trade-off** — genuine alternatives existed and you picked one

Skip it if easy to reverse, not surprising, or there was no real alternative.`;

// ── Grill prompts ──────────────────────────────────────────────────────────

function grillPrompt(topic: string): string {
	return `Grill me about: ${topic}

You are running a relentless interview to sharpen this plan or design. Use the "ask" tool, ONE question at a time, waiting for my answer before continuing.

Rules:
- Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
- For each question, provide your recommended answer as the first option (mark it "(recommended)").
- Provide 3-5 clear, distinct options; use multiSelect only when several choices can coexist.
- If a question can be answered by exploring the codebase, explore the codebase instead of asking.
- Challenge assumptions: if a decision seems weak, say so and offer a better alternative.
- If I cancel a question, rephrase or continue with what you know — never loop.
- After the session, summarize the decisions in 3-5 lines and propose next steps.`;
}

function grillDocsPrompt(topic: string): string {
	return `Grill me about: ${topic} — and stress-test it against the domain model.

Use the "ask" tool, ONE question at a time, waiting for my answer before continuing. For each question provide your recommended answer as the first option (mark it "(recommended)").

## Domain awareness

Explore the codebase and existing documentation before and during the session:

- If a \\\`CONTEXT.md\\\` exists at the root, read it (single context).
- If a \\\`CONTEXT-MAP.md\\\` exists, read it to find each context's CONTEXT.md.
- Look for \\\`docs/adr/\\\` (system-wide) and per-context \\\`docs/adr/\\\`.
- Create files lazily — only when you have something to write.

## During the session

1. **Challenge against the glossary.** When my term conflicts with the language in CONTEXT.md, call it out immediately.
2. **Sharpen fuzzy language.** Propose a precise canonical term for vague or overloaded words.
3. **Discuss concrete scenarios.** Stress-test domain relationships with edge-case scenarios.
4. **Cross-reference with code.** If what I say contradicts the code, surface it.
5. **Update CONTEXT.md inline.** When a term is resolved, update it right there (format below).
6. **Offer ADRs sparingly.** Only when ALL three hold: hard to reverse, surprising without context, real trade-off.

## Formats

CONTEXT.md: ${CONTEXT_FORMAT}

ADR: ${ADR_FORMAT}

If I cancel a question, rephrase or continue with what you know — never loop. After the session, summarize decisions and list any CONTEXT.md / ADR updates you made.`;
}

// ── Keyword auto-trigger ───────────────────────────────────────────────────

const GRILL_KEYWORDS = [
	"grillami",
	"grill me",
	"grilling",
	"sfida il mio piano",
	"sfida il piano",
	"stress-test il piano",
	"stress test il piano",
	"metti alla prova il piano",
	"intervista serrata",
	"interrogami",
	"cross-examine",
	"challenge my plan",
	"stress-test my plan",
	"grill with docs",
	"grill-with-docs",
];

/** Phrases that upgrade a grill to the domain-aware variant. */
const GRILL_DOCS_KEYWORDS = [
	"grill-with-docs",
	"grill with docs",
	"grillami col dominio",
	"contro il dominio",
	"contro il domain model",
	"con il glossario",
	"sfida il piano contro",
	"domain-aware",
	"con CONTEXT.md",
];

export function registerGrillCommands(pi: ExtensionAPI) {
	pi.registerCommand("ask-grill", {
		description: "Run a relentless interview to sharpen a plan or design (one question at a time, recommended answers)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ask-grill requires interactive mode", "error");
				return;
			}
			const topic = (args ?? "").trim() || "the current plan";
			await pi.sendUserMessage(grillPrompt(topic), { deliverAs: "followUp" });
		},
	});

	pi.registerCommand("ask-grill-docs", {
		description: "Grill against the domain model: CONTEXT.md glossary, ADRs, and code (absorbs grill-with-docs)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("ask-grill-docs requires interactive mode", "error");
				return;
			}
			const topic = (args ?? "").trim() || "the current plan";
			await pi.sendUserMessage(grillDocsPrompt(topic), { deliverAs: "followUp" });
		},
	});
}

export function registerGrillAutoTrigger(pi: ExtensionAPI) {
	pi.on("input", async (event) => {
		if (event.source !== "interactive") return { action: "continue" };
		const text = (event.text ?? "").trim();
		if (!text || text.startsWith("/")) return { action: "continue" };

		const lower = text.toLowerCase();
		const docsHit = GRILL_DOCS_KEYWORDS.find((k) => lower.includes(k));
		if (docsHit) {
			await pi.sendUserMessage(grillDocsPrompt(text), { deliverAs: "followUp" });
			return { action: "handled" };
		}
		const grillHit = GRILL_KEYWORDS.find((k) => lower.includes(k));
		if (grillHit) {
			await pi.sendUserMessage(grillPrompt(text), { deliverAs: "followUp" });
			return { action: "handled" };
		}
		return { action: "continue" };
	});
}

// ── System-prompt guardrail ────────────────────────────────────────────────

const GRILL_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail — grill mode)\\nThe user's message requests a grilling session to sharpen a plan or design. You MUST drive it through the \`ask\` tool, ONE question at a time — do not reply with plain-text questions. For each question, put your recommended answer first, marked "(recommended)". If the user cancels, rephrase or continue — never loop.`;

const GRILL_DOCS_GUARDRAIL = `\n\n## MANDATORY INSTRUCTION (pi-ask guardrail — domain-aware grill)\\nThe user's message requests a domain-aware grilling session. You MUST drive it through the \`ask\` tool, ONE question at a time — do not reply with plain-text questions. Challenge the plan against CONTEXT.md glossary and ADRs, explore the codebase to answer questions yourself, sharpen fuzzy terminology, and update CONTEXT.md / ADRs inline as decisions crystallise.`;

export function registerGrillGuardrails(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const prompt = (event.prompt ?? "").trim();
		if (!prompt || prompt.startsWith("/")) return;
		const lower = prompt.toLowerCase();
		const docsHit = GRILL_DOCS_KEYWORDS.find((k) => lower.includes(k));
		if (docsHit) return { systemPrompt: `${event.systemPrompt}${GRILL_DOCS_GUARDRAIL}` };
		const grillHit = GRILL_KEYWORDS.find((k) => lower.includes(k));
		if (grillHit) return { systemPrompt: `${event.systemPrompt}${GRILL_GUARDRAIL}` };
	});
}
