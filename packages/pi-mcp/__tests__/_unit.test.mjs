/**
 * pi-mcp - unit tests for helper modules
 *
 * Run: node --import tsx --test unit.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { throwIfAborted, abortable } from "../lib/_abort.ts";
import {
  interpolateEnvVars,
  toStringRecord,
  interpolateEnvRecord,
  resolveCommandSecret,
  resolveCommandSecretsRecord,
} from "../lib/_utils.ts";
import { computeServerHash, parseDirectToolSelectors, getMissingConfiguredDirectToolServers } from "../lib/_metadata-cache.ts";
import { formatSchema, findToolByName } from "../lib/_tool-metadata.ts";
import { createJsonSchemaValidator } from "../lib/_json-schema-validator.ts";
import { McpUiError, ServerError, ConsentError } from "../lib/_errors.ts";
import { formatToolName, formatPromptCommandName } from "../lib/_types.ts";
import { isInstantHelpResult } from "../lib/_prompts.ts";

// ── abort.ts ──────────────────────────────────────────────────────

test("throwIfAborted: no-op without signal or with non-aborted signal", () => {
  throwIfAborted();
  throwIfAborted(new AbortController().signal);
});

test("throwIfAborted: throws on aborted signal", () => {
  const ac = new AbortController();
  ac.abort();
  assert.throws(() => throwIfAborted(ac.signal));
});

test("abortable: resolves the underlying promise when not aborted", async () => {
  assert.equal(await abortable(Promise.resolve(42), new AbortController().signal), 42);
});

test("abortable: throws when aborted before settle", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(abortable(Promise.resolve(42), ac.signal));
});

// ── config.ts: best-effort host discovery ────────────────────────

test("MCP discovery reports invalid Codex TOML without logging an Error stack", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-mcp-invalid-codex-"));
  const cwd = join(home, "project");
  const codexDir = join(home, ".codex");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(
    join(codexDir, "config.toml"),
    '[mcp_servers.duplicate]\ncommand = "first"\n[mcp_servers.duplicate]\ncommand = "second"\n',
  );

  const configModuleUrl = new URL("../lib/_config.ts", import.meta.url).href;
  const script = `
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map((value) => String(value)).join(" "));
    const { getMcpDiscoverySummary } = await import(${JSON.stringify(configModuleUrl)});
    const summary = getMcpDiscoverySummary(undefined, ${JSON.stringify(cwd)});
    process.stdout.write(JSON.stringify({ warnings, importIssues: summary.importIssues }));
  `;
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: packageDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
      },
    },
  );
  const result = JSON.parse(output);

  assert.deepEqual(result.warnings, [], "best-effort discovery must not write over the TUI");
  assert.equal(result.importIssues.length, 1);
  assert.equal(result.importIssues[0].kind, "codex");
  assert.equal(result.importIssues[0].path, join(codexDir, "config.toml"));
  assert.match(result.importIssues[0].message, /Invalid TOML document/i);
  assert.ok(!result.importIssues[0].message.includes("\n"), "modal warning must fit on one line");
});

// ── utils.ts: env interpolation ───────────────────────────────────

test("interpolateEnvVars: expands all supported syntaxes", () => {
  process.env.PI_MCP_TEST_VAR = "hello";
  assert.equal(interpolateEnvVars("${PI_MCP_TEST_VAR}!"), "hello!");
  assert.equal(interpolateEnvVars("$env:PI_MCP_TEST_VAR"), "hello");
  assert.equal(interpolateEnvVars("{env:PI_MCP_TEST_VAR}"), "hello");
  delete process.env.PI_MCP_TEST_VAR;
  assert.equal(interpolateEnvVars("${PI_MCP_TEST_VAR}"), "", "missing var → empty");
});

test("toStringRecord / interpolateEnvRecord: shape coercion", () => {
  assert.equal(toStringRecord(undefined), undefined);
  assert.equal(toStringRecord("nope"), undefined);
  assert.deepEqual(toStringRecord({ a: 1, b: "x" }), { b: "x" }, "non-string values are dropped");
  assert.equal(interpolateEnvRecord(undefined), undefined);
  process.env.PI_MCP_TEST_VAR = "world";
  assert.deepEqual(interpolateEnvRecord({ a: "hi ${PI_MCP_TEST_VAR}" }), { a: "hi world" });
  delete process.env.PI_MCP_TEST_VAR;
});

// ── utils.ts: command secrets ─────────────────────────────────────

test("resolveCommandSecret: plain values are env-interpolated", () => {
  process.env.PI_MCP_TEST_VAR = "plain";
  assert.equal(resolveCommandSecret("token-${PI_MCP_TEST_VAR}", "x"), "token-plain");
  delete process.env.PI_MCP_TEST_VAR;
});

test("resolveCommandSecret: !! escapes command execution", () => {
  assert.equal(resolveCommandSecret("!!echo hi", "x"), "!echo hi");
});

test("resolveCommandSecret: ! runs a command and trims stdout", () => {
  assert.equal(resolveCommandSecret("!printf ' secret '", "x"), "secret");
});

test("resolveCommandSecret: failing command throws with context", () => {
  assert.throws(() => resolveCommandSecret("!exit 3", "server X token"), /Failed to resolve server X token/);
});

test("resolveCommandSecret: empty output throws", () => {
  assert.throws(() => resolveCommandSecret("!true", "x"), /empty output/);
});

test("resolveCommandSecret: undefined input → undefined", () => {
  assert.equal(resolveCommandSecret(undefined, "x"), undefined);
});

test("resolveCommandSecretsRecord: undefined input → undefined, resolves entries", () => {
  assert.equal(resolveCommandSecretsRecord(undefined, () => "x"), undefined);
  process.env.PI_MCP_TEST_VAR = "v";
  const out = resolveCommandSecretsRecord({ a: "${PI_MCP_TEST_VAR}", b: "!printf bee" }, (k) => `key ${k}`);
  assert.deepEqual(out, { a: "v", b: "bee" });
  delete process.env.PI_MCP_TEST_VAR;
});

// ── metadata-cache.ts ─────────────────────────────────────────────

test("computeServerHash: deterministic and sensitive to identity fields", () => {
  const def = { command: "npx", args: ["-y", "server"], env: { FOO: "${X}" } };
  const h1 = computeServerHash(def);
  const h2 = computeServerHash({ ...def });
  assert.equal(h1, h2, "identical definitions hash equal");
  const h3 = computeServerHash({ ...def, args: ["-y", "other"] });
  assert.notEqual(h1, h3, "different args hash different");
});

test("parseDirectToolSelectors: bare names → servers, server/tool → tools", () => {
  const parsed = parseDirectToolSelectors(["github", "fs/read", "fs/write", "mcp/"]);
  assert.ok(parsed.servers.has("github"));
  assert.deepEqual([...parsed.tools.get("fs")].sort(), ["read", "write"]);
  assert.ok(parsed.servers.has("mcp"), "trailing slash stripped → server selector");
});

test("getMissingConfiguredDirectToolServers: reports servers without valid cache", () => {
  const config = {
    mcpServers: {
      alpha: { command: "npx", directTools: true },
      beta: { command: "npx", directTools: false },
      gamma: { command: "npx" },
    },
  };
  const missing = getMissingConfiguredDirectToolServers(config, null);
  assert.deepEqual(missing, ["alpha"], "only direct-tool servers without cache are missing");
});

// ── tool-metadata.ts ──────────────────────────────────────────────

test("formatSchema: handles empty and object schemas", () => {
  assert.match(formatSchema(undefined), /no schema/);
  assert.match(formatSchema({ type: "object", properties: {} }), /no parameters/);
  const out = formatSchema({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
  assert.ok(out.includes("name"), "property listed");
  assert.ok(out.includes("*"), "required marker present");
});

test("findToolByName: matches prefixed tool names", () => {
  const metadata = [{ name: "server_toolA", originalName: "toolA" }, { name: "server_toolB", originalName: "toolB" }];
  assert.equal(findToolByName(metadata, "server_toolA").originalName, "toolA");
  assert.equal(findToolByName(metadata, "missing"), undefined);
});

// ── json-schema-validator.ts ──────────────────────────────────────

test("json schema validator: accepts valid args, rejects invalid", () => {
  const provider = createJsonSchemaValidator();
  const validate = provider.getValidator({
    type: "object",
    properties: { count: { type: "integer" } },
    required: ["count"],
  });
  const ok = validate({ count: 3 });
  assert.equal(ok.valid, true);
  const bad = validate({ count: "three" });
  assert.equal(bad.valid, false);
  assert.ok(bad.errorMessage.length > 0);
});

// ── errors.ts ─────────────────────────────────────────────────────

test("McpUiError: carries code, context and recovery hint", () => {
  const err = new McpUiError("boom", { code: "E_TEST", context: { server: "s1" }, recoveryHint: "restart" });
  assert.equal(err.code, "E_TEST");
  assert.equal(err.context.server, "s1");
  assert.equal(err.recoveryHint, "restart");
  assert.ok(err instanceof Error);
});

test("error subclasses keep their type and code", () => {
  const serverErr = new ServerError("down", { server: "s1" });
  assert.ok(serverErr instanceof McpUiError);
  assert.ok(serverErr instanceof Error);
  const consentErr = new ConsentError("denied", {});
  assert.ok(consentErr instanceof McpUiError);
  assert.equal(consentErr.code, "CONSENT_REQUIRED");
});

// ── _types.ts: comandi slash nudi (toolPrefix "none") ────────────────
// Richiesta: /pix-frontend-vanilla-reactive, /pix-process-code-review,
// /pix-data-indexed-db - niente prefisso server, trattini al posto degli underscore.

test("isInstantHelpResult detects single assistant usage messages", () => {
  const usage = "Usage: /pix-frontend <request>\n\nFrontend work following pix styleguides.";
  const text = (t) => ({ role: "assistant", content: { type: "text", text: t } });
  assert.equal(isInstantHelpResult({ messages: [text(usage)] }), usage, "single assistant usage text is instant help");
  assert.equal(
    isInstantHelpResult({ messages: [{ role: "user", content: { type: "text", text: usage } }] }),
    null,
    "user role is not instant help",
  );
  assert.equal(isInstantHelpResult({ messages: [text("hello world")] }), null, "must start with Usage: /");
  assert.equal(isInstantHelpResult({ messages: [text(usage), text("extra")] }), null, "single message only");
  assert.equal(
    isInstantHelpResult({ messages: [{ role: "assistant", content: { type: "image", data: "", mimeType: "image/png" } }] }),
    null,
    "text content only",
  );
});

test("formatToolName with \"none\": bare dash-separated tool command", () => {
  assert.equal(formatToolName("pix_frontend_vanilla_reactive", "pix-galaxy-mcp", "none"), "pix-frontend-vanilla-reactive");
  assert.equal(formatToolName("pix_process_code_review", "pix-galaxy-mcp", "none"), "pix-process-code-review");
  assert.equal(formatToolName("pix_data_indexed_db", "pix-galaxy-mcp", "none"), "pix-data-indexed-db");
  assert.equal(formatToolName("pix", "pix-galaxy-mcp", "none"), "pix");
});

test("formatPromptCommandName with \"none\": bare prompt command (no mcp__server__ prefix)", () => {
  assert.equal(formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "none"), "pix-code-review");
  assert.equal(formatPromptCommandName("pix-generate-component", "pix-galaxy-mcp", "none"), "pix-generate-component");
  assert.equal(formatPromptCommandName("pix-a11y-test", "pix-galaxy-mcp", "none"), "pix-a11y-test");
});

test("other prefix modes keep the legacy naming (regression)", () => {
  // Tools
  assert.equal(formatToolName("pix_process_code_review", "pix-galaxy-mcp", "server"), "pix_galaxy_mcp_pix_process_code_review");
  assert.equal(formatToolName("pix_process_code_review", "pix-galaxy-mcp", "short"), "pix_galaxy_pix_process_code_review");
  assert.equal(formatToolName("pix_process_code_review", "pix-galaxy-mcp", "mcp"), "mcp__pix_galaxy_mcp_pix_process_code_review");
  // Prompts keep the mcp__server__ prefix in every non-none mode
  assert.equal(formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "server"), "mcp__pix_galaxy_mcp__pix-code-review");
  assert.equal(formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "short"), "mcp__pix_galaxy__pix-code-review");
  assert.equal(formatPromptCommandName("pix-code-review", "pix-galaxy-mcp", "mcp"), "mcp__mcp__pix_galaxy_mcp__pix-code-review");
});
