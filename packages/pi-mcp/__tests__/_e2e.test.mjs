/**
 * pi-mcp - e2e test suite (extension factory level)
 *
 * Run: node --import tsx --test e2e.test.mjs
 *
 * Drives the adapter factory with a mock ExtensionAPI and an injected,
 * server-free config: tool/command/flag registration, event handlers,
 * and the proxy tool's argument validation.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.MCP_DIRECT_TOOLS = ""; // no direct-tool env overrides

import * as packageEntry from "../index.ts";
import { createMcpAdapter } from "../index.ts";
import { createMockPi, createMockCtx } from "../../../test/harness.mjs";

test("package entry exports Pi's default extension factory", () => {
  assert.equal(typeof packageEntry.default, "function");
});

function install(overrides = {}) {
  const { pi, emit, runCommand, commands, tools, handlers, calls } = createMockPi(overrides);
  const adapter = createMcpAdapter({ config: { mcpServers: {} } });
  adapter(pi);
  return { pi, emit, runCommand, commands, tools, handlers, calls };
}

test("adapter registers the mcp proxy tool and commands", () => {
  const { tools, commands, handlers } = install();
  assert.ok(tools.has("mcp"), "mcp proxy tool registered");
  assert.ok(commands.has("mcp"), "/mcp command registered");
  assert.ok(commands.has("mcp-auth"), "/mcp-auth command registered");
  for (const event of ["session_start", "session_shutdown", "tool_result"]) {
    assert.ok(handlers.get(event)?.length, `handler for ${event} registered`);
  }
});

test("adapter registers the mcp-config flag", () => {
  const { calls } = install();
  assert.ok(calls.registerFlag.some(([name]) => name === "mcp-config"));
});

test("mcp tool: missing action returns guidance instead of crashing", async () => {
  const { tools } = install();
  const tool = tools.get("mcp");
  const result = await tool.execute("call-1", {});
  assert.ok(result.content, "returns content");
  assert.ok(result.content[0].text.length > 0);
});

test("mcp tool: invalid JSON args are reported with a descriptive error", async () => {
  const { tools } = install();
  const tool = tools.get("mcp");
  await assert.rejects(
    tool.execute("call-1", { action: "call", args: "{not json" }),
    /Invalid args JSON/,
  );
});

test("session_start handler exists and runs without throwing", async () => {
  const { emit } = install();
  const ctx = createMockCtx();
  await emit("session_start", {}, ctx);
  assert.ok(true);
});

test("session_shutdown handler runs without throwing", async () => {
  const { emit } = install();
  await emit("session_shutdown", {});
  assert.ok(true);
});

test("adapter factory is reusable per mock pi instance", () => {
  const a = install();
  const b = install();
  assert.notEqual(a.handlers, b.handlers);
  assert.ok(a.tools.has("mcp") && b.tools.has("mcp"));
});

test("load-time init with keep-alive servers is skipped when the runtime is unbound (headless CLI)", async () => {
  // Simulates `pi install` / trust evaluation: extensions are loaded with a
  // runtime whose action methods still throw until bindCore() runs (and in CLI
  // processes, they are never bound). Regression: this used to print
  // "MCP initialization failed: Extension runtime not initialized..." on every
  // install command after pi-mcp was added to settings.
  const notInitialized = () => {
    throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
  };
  const { pi, calls } = createMockPi({
    getActiveTools: notInitialized,
    setActiveTools: notInitialized,
  });

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const adapter = createMcpAdapter({
      config: {
        mcpServers: {
          "keep-alive-server": {
            command: "/usr/bin/false",
            lifecycle: "keep-alive",
          },
        },
      },
    });
    adapter(pi);
    // Give the scheduled setImmediate load-time init a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    console.error = originalError;
  }

  assert.ok(
    !errors.some((line) => line.includes("MCP initialization failed")),
    `unexpected error output: ${errors.join("\n")}`,
  );
  assert.equal(calls.setActiveTools.length, 0, "no action methods may be called while unbound");
});
