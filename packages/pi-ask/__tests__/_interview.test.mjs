/**
 * pi-ask — extension factory & interview command tests
 *
 * Uses the monorepo mock harness: runs the extension factory against a mock
 * ExtensionAPI and asserts tool/command registration and the /interview
 * flow.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import piAskExtension from "../lib/index.ts";
import { createMockPi, createMockCtx } from "../../../test/harness.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, "..", "skills", "interview", "SKILL.md");

test("extension registers ask, questionnaire tools and the /interview command", () => {
	const { pi, tools, commands } = createMockPi();
	piAskExtension(pi);

	assert.ok(tools.has("ask"));
	assert.ok(tools.has("questionnaire"));
	assert.ok(commands.has("interview"));
});

test("interview command sends a follow-up interview prompt to the model", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("interview").handler("project setup", ctx);

	assert.equal(calls.sendUserMessage.length, 1);
	const [content, opts] = calls.sendUserMessage[0];
	assert.equal(opts.deliverAs, "followUp");
	assert.match(content, /Interview mode/);
	assert.match(content, /project setup/);
});

test("interview command defaults the topic when no args are given", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "tui" });
	await commands.get("interview").handler("", ctx);

	const [content] = calls.sendUserMessage[0];
	assert.match(content, /the current task/);
});

test("interview command refuses to run in non-interactive mode", async () => {
	const { pi, commands, calls } = createMockPi();
	piAskExtension(pi);

	const ctx = createMockCtx({ mode: "print", ui: { notify: () => {} } });
	await commands.get("interview").handler("topic", ctx);

	assert.equal(calls.sendUserMessage.length, 0);
});

test("interview skill file ships with the package", () => {
	assert.ok(existsSync(SKILL_PATH), "skills/interview/SKILL.md must exist");
	const content = readFileSync(SKILL_PATH, "utf-8");
	assert.match(content, /^name: interview/m);
	assert.match(content, /description:/m);
	assert.match(content, /ask|questionnaire/);
});

test("package manifest exposes the skills directory", () => {
	const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
	assert.deepEqual(pkg.pi.skills, ["./skills"]);
	assert.ok(pkg.pi.extensions.includes("./index.ts"));
});
