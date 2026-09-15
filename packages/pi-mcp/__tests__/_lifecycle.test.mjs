/**
 * pi-mcp - lifecycle and render-coalescing tests (PERF-06)
 *
 * Health-check reconnect must tolerate a hung server: reconnects run
 * concurrently with a per-attempt timeout, failures back off with jitter,
 * and one bad server never delays the rest. Panel renders coalesce through
 * a microtask scheduler so a burst of events causes a single render.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { McpLifecycleManager } from "../lib/_lifecycle.ts";
import { createRenderCoalescer } from "../lib/_utils.ts";

const HANGING = () => new Promise(() => {});

function fakeManager() {
  const connected = new Set();

  return {
    connected,
    manager: {
      getConnection: (name) => (connected.has(name) ? { status: "connected" } : null),
      connect: async (name) => {
        if (name === "slow") {
          await HANGING();
        }

        connected.add(name);
      },
      isIdle: () => false,
      close: async () => {},
      closeAll: async () => {},
    },
  };
}

test("health check: one hung server does not delay the others", { timeout: 3000 }, async () => {
  const { manager, connected } = fakeManager();
  const lm = new McpLifecycleManager(manager, () => false, {
    connectTimeoutMs: 50,
    backoffBaseMs: 1,
    backoffMaxMs: 10,
    reconnectLimit: 4,
  });

  lm.registerServer("fast", { command: "fast" });
  lm.registerServer("slow", { command: "slow" });
  lm.markKeepAlive("fast", { command: "fast" });
  lm.markKeepAlive("slow", { command: "slow" });

  const t0 = Date.now();

  await lm.checkConnections();
  assert.ok(connected.has("fast"), "fast server reconnects while slow hangs");
  assert.ok(Date.now() - t0 < 2500, "a health pass must finish despite the hung server");
});

test("health check: failed reconnect backs off and retries later", { timeout: 3000 }, async () => {
  let attempts = 0;
  const manager = {
    getConnection: () => null,
    connect: async (name) => {
      attempts++;
      throw new Error(`boom ${name}`);
    },
    isIdle: () => false,
    close: async () => {},
    closeAll: async () => {},
  };
  const lm = new McpLifecycleManager(manager, () => false, {
    connectTimeoutMs: 20,
    backoffBaseMs: 5,
    backoffMaxMs: 50,
    reconnectLimit: 4,
  });

  lm.registerServer("s", { command: "s" });
  lm.markKeepAlive("s", { command: "s" });

  await lm.checkConnections();
  assert.equal(attempts, 1, "first pass attempts once");

  await lm.checkConnections(); // immediately after failure -> backoff skips
  assert.equal(attempts, 1, "backoff prevents an immediate re-attempt");

  await new Promise((resolve) => setTimeout(resolve, 80)); // beyond max backoff
  await lm.checkConnections();
  assert.equal(attempts, 2, "a later pass attempts again");
});

test("render coalescer: a burst of events produces one render", async () => {
  let renders = 0;
  const schedule = createRenderCoalescer(() => renders++);

  schedule();
  schedule();
  schedule();
  schedule();
  assert.equal(renders, 0, "synchronous calls must not render immediately");

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 1, "one render after the tick");

  schedule();
  schedule();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 2, "a later burst produces exactly one more render");
});