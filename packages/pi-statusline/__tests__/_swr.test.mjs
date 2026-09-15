/**
 * pi-statusline - stale-while-revalidate tests (PERF-01)
 *
 * The widget render path is synchronous and runs on every TUI frame, so it
 * must never block on a subprocess. Fresh cache hits and cold/stale misses
 * serve synchronously (cached value or neutral fallback) while an async
 * background refresh backfills the cache single-flight per cwd.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";

import { getGitStatus, invalidateGitCache, flushGitRefreshes } from "../lib/_git.ts";
import { getProjectPath, invalidateProjectPathCache, flushProjectPathRefreshes } from "../lib/_helpers.ts";

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-swr-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name Tester", { cwd: dir });
  writeFileSync(join(dir, "file.txt"), "hello\n");
  execSync("git add . && git commit -qm init", { cwd: dir });
  return dir;
}

test("git cold cache serves fallback synchronously and backfills async", async () => {
  const dir = makeTempRepo();
  invalidateGitCache(dir);

  // Cold: no spawn, neutral fallback so the frame never blocks.
  const cold = getGitStatus(dir);
  assert.equal(cold.hasGit, false);
  assert.equal(cold.status, null);

  // Background refresh backfills the real value.
  await flushGitRefreshes();
  const warm = getGitStatus(dir);
  assert.equal(warm.hasGit, true);
  assert.equal(warm.status?.branch, "main");
});

test("git stale entry is served while refresh updates it in background", async () => {
  const dir = makeTempRepo();
  invalidateGitCache(dir);

  // Prime with a clean tree via the explicit sync path.
  const primed = getGitStatus(dir, true);
  assert.equal(primed.status?.dirty, 0);

  // Dirty the tree, then expire the entry by dropping it: the next call is
  // cold again, so it must serve the fallback, not block on git.
  writeFileSync(join(dir, "file.txt"), "changed\n");
  invalidateGitCache(dir);
  const served = getGitStatus(dir);
  assert.equal(served.hasGit, false);
  assert.equal(served.status, null);

  await flushGitRefreshes();
  const fresh = getGitStatus(dir);
  assert.equal(fresh.hasGit, true);
  assert.equal(fresh.status?.dirty, 1);
});

test("project path cold cache serves basename and backfills async", async () => {
  const dir = makeTempRepo();
  const sub = join(dir, "sub");
  mkdirSync(sub);
  invalidateProjectPathCache(dir);
  invalidateProjectPathCache(sub);

  // Cold: synchronous basename fallback, zero spawns.
  const cold = getProjectPath(sub, "git-relative");
  assert.equal(cold, basename(sub));

  await flushProjectPathRefreshes();
  const warm = getProjectPath(sub, "git-relative");
  assert.equal(warm, `${basename(dir)}/sub`);
});

test("force=true keeps synchronous resolution", () => {
  const dir = makeTempRepo();
  invalidateGitCache(dir);
  const result = getGitStatus(dir, true);
  assert.equal(result.hasGit, true);
  assert.equal(result.status?.branch, "main");
});
