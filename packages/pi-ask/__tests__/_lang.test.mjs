/**
 * pi-ask - chat-language detection tests
 *
 * The `interview` tool renders its progress header (`Interview 1/2`) and the
 * review-tab hint (`next interview`) in the chat language. Language is
 * detected from recent user messages, defaulting to English.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
	chatInterviewLabel,
	chatInterviewNextSuffix,
	detectChatLanguage,
	resetChatLanguageForTests,
	trackChatLanguage,
} from "../lib/_lang.ts";

test("lang: detectChatLanguage picks Italian from Italian stopwords", () => {
	assert.equal(detectChatLanguage(["vorrei un'intervista, fammi qualche domanda per favore"]), "it");
	assert.equal(detectChatLanguage(["fammi una domanda sul progetto"]), "it");
});

test("lang: detectChatLanguage picks English from English stopwords", () => {
	assert.equal(detectChatLanguage(["please ask me a few questions about the project"]), "en");
	assert.equal(detectChatLanguage(["could you help me with this?"]), "en");
});

test("lang: detectChatLanguage defaults to English on empty or neutral text", () => {
	assert.equal(detectChatLanguage([]), "en");
	assert.equal(detectChatLanguage(["ok"]), "en");
});

test("lang: chatInterviewLabel localizes the interview word after tracking", () => {
	resetChatLanguageForTests();
	assert.equal(chatInterviewLabel(), "Interview");
	trackChatLanguage(["vorrei un'intervista, fammi qualche domanda"]);
	assert.equal(chatInterviewLabel(), "Intervista");
});

test("lang: chatInterviewNextSuffix localizes the next-chunk phrase", () => {
	resetChatLanguageForTests();
	assert.equal(chatInterviewNextSuffix(), "next interview");
	trackChatLanguage(["vorrei un'intervista, fammi qualche domanda"]);
	assert.equal(chatInterviewNextSuffix(), "prossima intervista");
});

test("lang: resetChatLanguageForTests restores English", () => {
	trackChatLanguage(["vorrei un'intervista"]);
	assert.equal(chatInterviewLabel(), "Intervista");
	resetChatLanguageForTests();
	assert.equal(chatInterviewLabel(), "Interview");
	assert.equal(chatInterviewNextSuffix(), "next interview");
});