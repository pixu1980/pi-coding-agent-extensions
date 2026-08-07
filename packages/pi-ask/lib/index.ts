/**
 * pi-ask - extension factory
 *
 * Registers the interactive Q&A tools:
 *   - `ask`           single question: options, custom answer, note (also
 *                     covers sharp plan interviews: recommended answers,
 *                     codebase exploration)
 *   - `interview`     multi-question interview flow, sequential
 *                     caller-controlled waves; the "con dominio" variant
 *                     adds domain-aware interviews (CONTEXT.md / ADR)
 *   - `/ask`          command for single-question mode
 *   - `/ask-interview` command for structured interviews / questionnaires
 *                     (append "con dominio" or `--docs` for domain-aware
 *                     interviews)
 *
 * Natural-language auto-trigger: input phrases like "fammi una domanda",
 * "fammi un questionario", "sfida il piano", or "intervistami col dominio"
 * route into the matching mode without a slash command. System-prompt
 * guardrails force the tools when the intent is detected, so the model
 * cannot answer with plain text.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAskTool } from "./_ask.ts";
import { createInterviewTool } from "./_interview-tool.ts";
import { registerAskAutoTrigger, registerAskCommands, registerAskGuardrails } from "./_commands.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool(createAskTool());
	pi.registerTool(createInterviewTool());
	registerAskCommands(pi);
	registerAskAutoTrigger(pi);
	registerAskGuardrails(pi);
}
