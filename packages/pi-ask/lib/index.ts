/**
 * pi-ask — extension factory
 *
 * Registers the interactive Q&A tools:
 *   - `ask`           single question: options, custom answer, note
 *   - `questionnaire` multi-question interview flow (Phase 3)
 *   - `/interview`    command that drives the interview mode (Phase 4)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAskTool } from "./_ask.ts";
import { registerInterviewCommand } from "./_interview.ts";
import { createQuestionnaireTool } from "./_questionnaire.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool(createAskTool());
	pi.registerTool(createQuestionnaireTool());
	registerInterviewCommand(pi);
}
