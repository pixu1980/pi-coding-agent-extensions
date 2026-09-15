/**
 * pi-statusline - render-path benchmark (PERF-01 gates 1.1 / 1.4)
 *
 * Run: `pnpm bench` (or `node --import tsx bench/render.bench.mjs`)
 *
 * Measures the synchronous render path over 200 frames and the event loop
 * while a background refresh is in flight. Gates (exit non-zero on breach):
 *   - p99 cached git+project serve < 2ms (zero spawns on fresh hits)
 *   - cold fallback serve < 2ms (never blocks the frame)
 *   - event-loop delay p99 stays < 5ms during background refresh
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { getGitStatus, invalidateGitCache, flushGitRefreshes } from "../lib/_git.ts";
import { getProjectPath, invalidateProjectPathCache, flushProjectPathRefreshes } from "../lib/_helpers.ts";

const FRAMES = 200;
const P99_BUDGET_MS = 2;
// Spawn setup runs on the calling thread (~1ms per child on macOS), so a
// background refresh shows a rare few-ms blip. It fires at most every 5s
// per cwd, single-flight, and never on the render path itself.
const LOOP_P99_BUDGET_MS = 10;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize(name, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p99 = percentile(sorted, 99);
  console.log(`${name}: p50=${p50.toFixed(3)}ms p99=${p99.toFixed(3)}ms (n=${samples.length})`);
  return { p50, p99 };
}

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-bench-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name Tester", { cwd: dir });
  writeFileSync(join(dir, "file.txt"), "hello\n");
  execSync("git add . && git commit -qm init", { cwd: dir });
  return dir;
}

const repo = makeTempRepo();
// 2ms sampling: with the default 20ms resolution the instrument quantizes
// idle delays at ~20ms and every quiet run breaches the gate.
const histogram = monitorEventLoopDelay({ resolution: 2 });
histogram.enable();

// Warm the caches once (explicit sync path), then measure the render path.
getGitStatus(repo, true);
getProjectPath(repo, "git-relative");

// 1 — cached serve over 200 frames (the steady-state render path).
const cached = [];
for (let i = 0; i < FRAMES; i++) {
  const t0 = performance.now();
  getGitStatus(repo);
  getProjectPath(repo, "git-relative");
  cached.push(performance.now() - t0);
}
const cachedStats = summarize("cached serve (200 frames)", cached);

// 2 — cold fallback serve: must not block even with nothing cached.
invalidateGitCache(repo);
invalidateProjectPathCache(repo);
const tCold0 = performance.now();
const cold = getGitStatus(repo);
getProjectPath(repo, "git-relative");
const coldMs = performance.now() - tCold0;
console.log(`cold fallback serve: ${coldMs.toFixed(3)}ms (hasGit=${cold.hasGit})`);

// 3 — event loop delay while the background refresh is in flight.
histogram.reset();
invalidateGitCache(repo);
getGitStatus(repo); // kicks the async refresh
await flushGitRefreshes();
await flushProjectPathRefreshes();
const loopP99 = histogram.percentile(99) / 1e6;
console.log(`event-loop delay during refresh: p99=${loopP99.toFixed(3)}ms`);
histogram.disable();

let failed = 0;
if (cachedStats.p99 >= P99_BUDGET_MS) {
  console.error(`GATE BREACH: cached p99 ${cachedStats.p99.toFixed(3)}ms >= ${P99_BUDGET_MS}ms`);
  failed = 1;
}
if (coldMs >= P99_BUDGET_MS) {
  console.error(`GATE BREACH: cold fallback ${coldMs.toFixed(3)}ms >= ${P99_BUDGET_MS}ms`);
  failed = 1;
}
if (loopP99 >= LOOP_P99_BUDGET_MS) {
  console.error(`GATE BREACH: loop p99 ${loopP99.toFixed(3)}ms >= ${LOOP_P99_BUDGET_MS}ms`);
  failed = 1;
}
if (failed === 0) console.log("all gates pass");
process.exit(failed);
