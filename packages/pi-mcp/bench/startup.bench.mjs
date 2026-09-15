/**
 * pi-mcp - startup import-graph probe (PERF-08 gate 8.4, PERF-10 load-robustness)
 *
 * Run: `pnpm bench` (or `node --import tsx bench/startup.bench.mjs`).
 *
 * Proves the startup graph stays lean: the heavy interactive panels are
 * dynamic-imported on first use, so they must NOT be present in the barrel's
 * startup graph. If a panel module were statically imported by index.ts, a
 * dynamic import after the barrel would resolve from the module cache almost
 * instantly; a real, multi-ms cold load proves it was deferred.
 *
 * Load-robustness (PERF-10): these gates only fail toward leniency under
 * load. A slow machine inflates every cold import further above the 50ms
 * laziness threshold (still PASS), while a module-cache hit stays microseconds
 * (still FAIL when eager). The machine context is printed so a red run can
 * be attributed to code, not weather. Reference (2026-09-15, loadavg ~110,
 * 10 cores): barrel 1742ms, _mcp-panel 1287ms lazy, _ui-server 0.2ms deferred.
 */

import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

const LIB = fileURLToPath(new URL("../lib/", import.meta.url));

// PERF-10 machine context, printed next to every gate verdict.
const cores = availableParallelism();
const loadOneMinute = loadavg()[0];
const spawnStart = performance.now();
await new Promise((resolve) => execFile(process.execPath, ["--version"], () => resolve()));
console.log(
  `machine: loadavg(1m)=${loadOneMinute.toFixed(1)} cores=${cores} ` +
    `spawn-baseline=${(performance.now() - spawnStart).toFixed(1)}ms`,
);

async function timed(label, spec) {
  const start = performance.now();
  await import(spec);
  return { label, ms: performance.now() - start };
}

// 1 — whole barrel in a fresh process (cold tsx compile of the graph).
const barrel = await timed("barrel (index.ts)", `${LIB}index.ts`);
console.log(`barrel import: ${barrel.ms.toFixed(1)}ms`);

// 2 — panels: the heavy one must stay cold after the barrel (= lazy). A
// regression that makes it eager would drop this to ~0ms. A panel whose
// exclusive subtree is small or shared with the barrel (marginal < 50ms) is
// fine either way: the startup graph paid nothing for it.
const HEAVY_PANELS = new Map([
  ["_mcp-panel.ts", "heavy interactive panel (must stay lazy)"],
  ["_mcp-setup-panel.ts", "setup panel (small shared subtree; informational)"],
]);
for (const [module, note] of HEAVY_PANELS) {
  const entry = await timed(module, `${LIB}${module}`);
  const lazy = entry.ms >= 50;
  const verdict = note.includes("informational") ? "(informational)" : lazy ? "(lazy, not in startup graph)" : "(CACHED — EAGER REGRESSION!)";
  console.log(`${entry.label}: ${entry.ms.toFixed(1)}ms ${verdict} ${note}`);
  if (!note.includes("informational") && !lazy) process.exitCode = 1;
}

// 3 — ui-server subtree: document its cost, gate stays informational.
const uiServer = await timed("_ui-server.ts subtree", `${LIB}_ui-server.ts`);
console.log(`_ui-server.ts subtree: ${uiServer.ms.toFixed(1)}ms (reached only via ui-session at first ui tool call)`);
console.log(process.exitCode === 1 ? "gate failed: a panel module is eager at startup" : "all gates pass");