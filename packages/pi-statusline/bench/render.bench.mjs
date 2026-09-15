/**
 * pi-statusline - render-path benchmark (PERF-01 gates 1.1 / 1.4, PERF-10 load-robustness)
 *
 * Run: `pnpm bench` (or `node --import tsx bench/render.bench.mjs`)
 *
 * Measures the synchronous render path over 200 frames and the event loop
 * while a background refresh is in flight.
 *
 * Gates come in two kinds (PERF-10):
 * - Load-invariant (always enforced): zero background refreshes across the
 *   200 cached frames, proven by the git cache counters. This is a property
 *   of the code, not of the machine.
 * - Wall-time budgets (cached p99 < 2ms, cold < 2ms, loop p99 < 10ms):
 *   enforced only on a quiet machine (1-minute loadavg below core count).
 *   On a loaded machine they are printed with a WARN and do not fail the
 *   run, because wall time then measures the scheduler, not the code. Set
 *   `PI_BENCH_QUIET=1` to force enforcement and `PI_BENCH_QUIET=0` to force
 *   reporting, so both arms hold on any machine.
 *
 * Reference (2026-09-15, loadavg ~110, 10 cores): cached p50 0.001ms
 * p99 0.03ms, cold ~0.05ms, loop p99 30-45ms (load-bound). Quiet-machine
 * numbers go here when re-recorded: cached p99 <2ms, cold <2ms, loop <10ms.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

import { getGitStatus, getGitCacheStats, invalidateGitCache, flushGitRefreshes } from "../lib/_git.ts";
import { getProjectPath, invalidateProjectPathCache, flushProjectPathRefreshes } from "../lib/_helpers.ts";
import { resolveQuietArm } from "./_quiet.mjs";

const FRAMES = 200;
const P99_BUDGET_MS = 2;
// Spawn setup runs on the calling thread (~1ms per child on macOS), so a
// background refresh shows a rare few-ms blip. It fires at most every 5s
// per cwd, single-flight, and never on the render path itself.
const LOOP_P99_BUDGET_MS = 10;

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }

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

// PERF-10 machine context: wall-time budgets are only meaningful on a quiet
// machine, so record the load and a trivial-spawn baseline next to the gates.
const cores = availableParallelism();
const loadOneMinute = loadavg()[0];
const quietOverride = process.env.PI_BENCH_QUIET;
const quietArm = resolveQuietArm({ coreCount: cores, loadOneMinute, override: quietOverride });
const quiet = quietArm.quiet;
const quietSource = quietArm.source === "forced" ? `forced by PI_BENCH_QUIET=${quietOverride?.trim()}` : "measured";
const spawnStart = performance.now();

await new Promise((resolve) => execFile(process.execPath, ["--version"], () => resolve()));

const spawnBaselineMs = performance.now() - spawnStart;

console.log(
  `machine: loadavg(1m)=${loadOneMinute.toFixed(1)} cores=${cores} spawn-baseline=${spawnBaselineMs.toFixed(1)}ms ` +
    (quiet
      ? `(quiet: wall budgets enforced, ${quietSource})`
      : `(loaded: wall budgets reported only, ${quietSource})`),
);
// 2ms sampling: with the default 20ms resolution the instrument quantizes
// idle delays at ~20ms and every quiet run breaches the gate.
const histogram = monitorEventLoopDelay({ resolution: 2 });

histogram.enable();

// Warm the caches once (explicit sync path), then measure the render path.
getGitStatus(repo, true);
getProjectPath(repo, "git-relative");

// 1 — cached serve over 200 frames (the steady-state render path).
const statsBefore = getGitCacheStats();
const cached = [];

for (let i = 0; i < FRAMES; i++) {
  const t0 = performance.now();

  getGitStatus(repo);
  getProjectPath(repo, "git-relative");
  cached.push(performance.now() - t0);
}

const statsAfter = getGitCacheStats();
const backgroundRefreshes =
  statsAfter.misses - statsBefore.misses + (statsAfter.staleServes - statsBefore.staleServes);
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

// Load-invariant gate: fresh cache hits must never spawn. Counters prove it
// on any machine, loaded or not.
if (backgroundRefreshes > 0) {
  console.error(`GATE BREACH: ${backgroundRefreshes} background refreshes during 200 cached frames (want 0)`);
  failed = 1;
}

// Wall-time budgets: enforced on quiet machines, reported with WARN on
// loaded ones (there they measure the scheduler, not the code).
function checkWall(ok, message) {
  if (ok) {
    return;
  }

  if (quiet) {
    console.error(`GATE BREACH: ${message}`);
    failed = 1;
  } else {
    console.warn(`WARN (loaded machine, not enforced): ${message}`);
  }
}

checkWall(cachedStats.p99 < P99_BUDGET_MS, `cached p99 ${cachedStats.p99.toFixed(3)}ms >= ${P99_BUDGET_MS}ms`);
checkWall(coldMs < P99_BUDGET_MS, `cold fallback ${coldMs.toFixed(3)}ms >= ${P99_BUDGET_MS}ms`);
checkWall(loopP99 < LOOP_P99_BUDGET_MS, `loop p99 ${loopP99.toFixed(3)}ms >= ${LOOP_P99_BUDGET_MS}ms`);

if (failed === 0) {
  console.log(quiet ? "all gates pass" : "invariant gates pass (wall budgets reported only - machine loaded)");
}

process.exit(failed);
