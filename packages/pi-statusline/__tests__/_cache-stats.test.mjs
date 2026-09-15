/**
 * pi-statusline - cache metrics and invalidation tests (PERF-05)
 *
 * Every render-path cache exposes hit/miss/stale counters so the debug dump
 * can report a hit rate, and each has an explicit invalidation path: branch
 * change clears the git entry for the cwd, cwd keys scope entries, and the
 * test hook expireGitCache forces the stale-serve branch deterministically.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { getGitStatus, invalidateGitCache, expireGitCache, getGitCacheStats, flushGitRefreshes } from "../lib/_git.ts";
import { getProjectPath, invalidateProjectPathCache, getProjectPathStats, flushProjectPathRefreshes } from "../lib/_helpers.ts";
import { getMcpInfo, getMcpStats } from "../lib/_mcp.ts";
import { createMockPi, createMockCtx, makeModel } from "../../../test/harness.mjs";
import statuslineExtension from "../index.ts";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { makeTheme } from "../../../test/harness.mjs";

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-stats-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name Tester", { cwd: dir });
  writeFileSync(join(dir, "file.txt"), "hello\n");
  execSync("git add . && git commit -qm init", { cwd: dir });
  return dir;
}

test("git cache stats: warm hit, invalidate miss, expire stale-serve", async () => {
  const dir = makeTempRepo();
  invalidateGitCache();

  // Warm via the explicit sync path, then one cached read is a hit.
  getGitStatus(dir, true);
  const before = getGitCacheStats();
  getGitStatus(dir);
  let after = getGitCacheStats();
  assert.equal(after.hits - before.hits, 1, "cached read must count as a hit");

  // Invalidate → the next non-force read is a cold miss (fallback + refresh).
  invalidateGitCache(dir);
  const beforeMiss = getGitCacheStats();
  getGitStatus(dir);
  after = getGitCacheStats();
  assert.equal(after.misses - beforeMiss.misses, 1, "invalidated entry must count as a miss");

  // Re-warm, expire the entry: the next read serves stale and refreshes.
  getGitStatus(dir, true);
  expireGitCache(dir);
  const beforeStale = getGitCacheStats();
  getGitStatus(dir);
  after = getGitCacheStats();
  assert.equal(after.staleServes - beforeStale.staleServes, 1, "expired entry must count as a stale serve");
  await flushGitRefreshes();
});

test("project path cache stats: served from memory after backfill", async () => {
  const dir = makeTempRepo();
  invalidateProjectPathCache();

  // Cold read kicks the async backfill; the value is not cached yet.
  const beforeCold = getProjectPathStats();
  getProjectPath(dir, "git-relative");
  let after = getProjectPathStats();
  assert.equal(after.misses - beforeCold.misses, 1, "cold project read must count as a miss");

  await flushProjectPathRefreshes();
  const beforeHit = getProjectPathStats();
  getProjectPath(dir, "git-relative");
  after = getProjectPathStats();
  assert.equal(after.hits - beforeHit.hits, 1, "backfilled read must count as a hit");
});

test("mcp info cache: each read changes exactly one counter, cached reads hit", () => {
  // Module cache is shared; earlier suites may have warmed it, so assert on
  // deltas: every call must move exactly one counter, and a call within TTL
  // must never move the miss counter.
  const before = getMcpStats();
  const first = getMcpInfo();
  const afterFirst = getMcpStats();
  const movedFirst = (afterFirst.hits - before.hits) + (afterFirst.misses - before.misses);
  assert.equal(movedFirst, 1, "each mcp info read must count as exactly one hit or miss");

  getMcpInfo();
  const afterSecond = getMcpStats();
  assert.equal(afterSecond.hits - afterFirst.hits, 1, "cached read must count as a hit");
  assert.equal(afterSecond.misses - afterFirst.misses, 0, "cached read must not count as a miss");
  assert.ok(first.total >= 0, "mcp info payload still returned");
});

test("/statusline debug reports per-cache hit rates", async () => {
  initTheme();
  const { pi, runCommand } = createMockPi();
  statuslineExtension(pi);
  const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4") });
  await runCommand("statusline", "debug", ctx);
  const notify = ctx.ui._uiCalls.find(([c]) => c === "notify");
  assert.ok(notify, "must notify");
  assert.match(notify[1], /git cache/, "report must include git cache counters");
  assert.match(notify[1], /hit rate/, "report must include a hit rate");
  assert.match(notify[1], /project cache|mcp cache/, "report must include the other caches");
});