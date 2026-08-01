/**
 * pi-ask — extension factory
 *
 * Registers the interactive Q&A tools:
 *   - `ask`           single question: options, custom answer, note
 *   - `interview`     multi-question interview flow, sequential questionnaires
 *   - `/ask`          command for single-question mode
 *   - `/ask-interview` command for structured interviews / questionnaires
 *   - `/ask-grill`    command for relentless plan-sharpening interviews
 *   - `/ask-grill-docs` command for domain-aware grilling (CONTEXT.md / ADR)
 *
 * Natural-language auto-trigger: input phrases like "fammi una domanda",
 * "fammi un questionario", or "grillami" route into the matching mode
 * without a slash command. System-prompt guardrails force the tools when
 * the intent is detected, so the model cannot answer with plain text.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAskTool } from "./_ask.ts";
import { createInterviewTool } from "./_interview-tool.ts";
import { registerAskAutoTrigger, registerAskCommands, registerAskGuardrails } from "./_commands.ts";
import { registerGrillAutoTrigger, registerGrillCommands, registerGrillGuardrails } from "./_grill.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool(createAskTool());
	pi.registerTool(createInterviewTool());
	registerAskCommands(pi);
	registerAskAutoTrigger(pi);
	registerAskGuardrails(pi);
	registerGrillCommands(pi);
	registerGrillAutoTrigger(pi);
	registerGrillGuardrails(pi);
}
