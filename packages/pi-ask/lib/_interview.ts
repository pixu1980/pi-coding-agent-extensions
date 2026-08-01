/**
 * pi-ask — `/interview` command
 *
 * Kicks off interview mode: sends the model a message that instructs it to
 * gather input from the developer one question at a time using the `ask`
 * and `questionnaire` tools.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function interviewPrompt(topic: string): string {
	return `Interview mode: gather input from the developer about: ${topic}

Follow the interview skill: ask ONE question at a time with the "ask" tool
(single-select with options; the user can pick with number keys, type a custom
answer, or attach a note with 'n'). Use "questionnaire" only for a small batch
of related questions (max 5-6). Provide 3-5 clear, distinct options. Use
multiSelect only when several choices can coexist. If the user cancels a
question, rephrase or continue with what you have — never loop. After the
answers, summarize in one or two lines and proceed with the task.

Start now with your first question.`;
}

export function registerInterviewCommand(pi: ExtensionAPI) {
	pi.registerCommand("interview", {
		description: "Start an interactive interview (asks questions via the ask/questionnaire tools)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("interview requires interactive mode", "error");
				return;
			}
			const topic = (args ?? "").trim() || "the current task";
			await pi.sendUserMessage(interviewPrompt(topic), { deliverAs: "followUp" });
		},
	});
}
