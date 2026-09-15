/**
 * pi-statusline - Git status detection
 *
 * Zero-impact policy: render runs on every TUI frame, so this module must
 * NEVER spawn a subprocess on the render path. Reads are stale-while-
 * revalidate per cwd:
 *   - fresh hit (git: 5s, non-git: 30s) → served synchronously, zero spawns
 *   - stale hit → stale value served synchronously, async refresh kicked
 *   - cold miss → neutral fallback served synchronously, async backfill kicked
 * Refreshes run via async execFile (off the event loop), single-flight per
 * cwd, with a 2s retry floor. Pass `force = true` for the explicit
 * synchronous query (tests, branch-change handling).
 */

import { execSync, execFile } from "node:child_process";
import type { GitStatus } from "./_types.js";

// ── Cache ──────────────────────────────────────────────────────

interface CacheEntry {
  status: GitStatus | null;
  hasGit: boolean;
  timestamp: number;
}

// Per-cwd cache: different terminals / projects share the process.
const cacheByCwd = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000; // fresh git status served up to 5s per cwd
const NEGATIVE_TTL_MS = 30000; // non-git dirs: at most every 30s
const REFRESH_TIMEOUT_MS = 1500; // per-command timeout for background refresh
const REFRESH_RETRY_MS = 2000; // floor between background attempts per cwd

// Single-flight background refreshes plus last-attempt throttle.
const pendingRefreshes = new Map<string, Promise<void>>();
const scheduledRefreshes = new Set<string>();
const lastAttemptByCwd = new Map<string, number>();

// ── Cache counters (PERF-05) ─────────────────────────────────────
// One counter set per process; the /statusline debug dump reports them.
// TTL rationale: 5s keeps the branch/dirty line fresh enough for a status
// display while bounding refresh to 12/min per cwd; 30s negative TTL stops
// non-git dirs from re-probing git repeatedly; 2s retry floor prevents a
// failing repo from spinning refreshes on every frame.

interface GitCacheStats {
  hits: number;
  misses: number;
  staleServes: number;
  invalidations: number;
}

const gitCacheStats: GitCacheStats = { hits: 0, misses: 0, staleServes: 0, invalidations: 0 };

export function getGitCacheStats(): GitCacheStats {
  return { ...gitCacheStats };
}

/**
 * Test/diagnostic hook: mark the cached entry for cwd as expired so the
 * next read takes the stale-serve branch (serves last-known-good while a
 * background refresh runs). No-op when nothing is cached for cwd.
 */
export function expireGitCache(cwd: string): void {
  const hit = cacheByCwd.get(cwd);
  if (hit) cacheByCwd.set(cwd, { ...hit, timestamp: 0 });
}

// ── Helpers ────────────────────────────────────────────────────

function run(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 800,
      cwd,
    }).trim();
  } catch {
    return null;
  }
}

function hasGit(cwd: string): boolean {
  const out = run("git rev-parse --is-inside-work-tree 2>/dev/null", cwd);
  return out === "true";
}

function getBranch(cwd: string): string | null {
  const out = run("git rev-parse --abbrev-ref HEAD 2>/dev/null", cwd);
  if (!out || out === "HEAD") return null;
  return out;
}

function getAheadBehind(cwd: string): { ahead: number; behind: number; hasUpstream: boolean } {
  const out = run("git rev-list --count --left-right @{upstream}...HEAD 2>/dev/null", cwd);
  if (!out) return { ahead: 0, behind: 0, hasUpstream: false };
  const parts = out.split("\t");
  if (parts.length !== 2) return { ahead: 0, behind: 0, hasUpstream: false };
  return {
    ahead: parseInt(parts[1] ?? "0", 10) || 0,
    behind: parseInt(parts[0] ?? "0", 10) || 0,
    hasUpstream: true,
  };
}

function getDirty(cwd: string): number {
  const out = run("git status --porcelain 2>/dev/null", cwd);
  if (!out) return 0;
  return out.split("\n").filter(Boolean).length;
}

// ── Async refresh (off the event loop) ─────────────────────────

/**
 * Run a git subcommand without a shell; never throws, resolves null on error.
 */
function runAsync(file: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf-8", timeout: REFRESH_TIMEOUT_MS, cwd }, (error, stdout) => {
      if (error) resolve(null);
      else resolve(String(stdout).trim());
    });
  });
}

interface AheadBehind { ahead: number; behind: number; hasUpstream: boolean }

function parseAheadBehind(out: string | null): AheadBehind {
  if (!out) return { ahead: 0, behind: 0, hasUpstream: false };
  const parts = out.split("\t");
  if (parts.length !== 2) return { ahead: 0, behind: 0, hasUpstream: false };
  return {
    ahead: parseInt(parts[1] ?? "0", 10) || 0,
    behind: parseInt(parts[0] ?? "0", 10) || 0,
    hasUpstream: true,
  };
}

/**
 * Full git query without blocking the event loop. Independent subcommands
 * run concurrently (fixed fan-out of 3, not input-driven). Git presence is
 * inferred from the branch query instead of a preliminary round-trip, so a
 * refresh is a single parallel batch. Never throws.
 */
async function queryGitAsync(cwd: string): Promise<{ status: GitStatus | null; hasGit: boolean }> {
  try {
    const [branchOut, abOut, dirtyOut] = await Promise.all([
      runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
      runAsync("git", ["rev-list", "--count", "--left-right", "@{upstream}...HEAD"], cwd),
      runAsync("git", ["status", "--porcelain"], cwd),
    ]);
    if (branchOut === null) return { hasGit: false, status: null };
    const branch = branchOut !== "HEAD" ? branchOut : "HEAD";
    const ab = parseAheadBehind(abOut);
    const dirty = dirtyOut ? dirtyOut.split("\n").filter(Boolean).length : 0;
    return { hasGit: true, status: { branch, ahead: ab.ahead, behind: ab.behind, dirty, hasUpstream: ab.hasUpstream } };
  } catch {
    return { hasGit: false, status: null };
  }
}

/**
 * Kick a single-flight background refresh for cwd. Safe to call per frame:
 * duplicate and too-frequent attempts are no-ops. The spawn setup is
 * deferred to `setImmediate` so the render call itself returns in
 * microseconds; the refresh never rejects.
 */
function refreshGitAsync(cwd: string): void {
  const now = Date.now();
  if (pendingRefreshes.has(cwd) || scheduledRefreshes.has(cwd)) return;
  if (now - (lastAttemptByCwd.get(cwd) ?? 0) < REFRESH_RETRY_MS) return;
  lastAttemptByCwd.set(cwd, now);
  scheduledRefreshes.add(cwd);
  const timer = setImmediate(() => {
    scheduledRefreshes.delete(cwd);
    if (pendingRefreshes.has(cwd)) return;
    const pending = queryGitAsync(cwd)
      .then((result) => {
        cacheByCwd.set(cwd, { status: result.status, hasGit: result.hasGit, timestamp: Date.now() });
      })
      .catch(() => {
        // queryGitAsync never throws; guard retained so refreshes stay silent.
      })
      .finally(() => {
        pendingRefreshes.delete(cwd);
      });
    pendingRefreshes.set(cwd, pending);
  });
  timer.unref();
}

/**
 * Await in-flight background refreshes. Diagnostic and test hook; render
 * code never needs it because reads always serve synchronously.
 *
 * @returns Promise that resolves when no refresh is in flight.
 */
export async function flushGitRefreshes(): Promise<void> {
  // Yield past deferred kicks so a refresh scheduled this tick is visible.
  await new Promise((resolve) => setImmediate(resolve));
  const pending = [...pendingRefreshes.values()];
  if (pending.length === 0) return;
  await Promise.all(pending);
  return flushGitRefreshes();
}

/**
 * Explicit synchronous query that bypasses the cache. Used for tests and
 * branch-change handling — never on the per-frame render path.
 */
function queryGitSync(cwd: string): { status: GitStatus | null; hasGit: boolean } {
  const now = Date.now();
  if (!hasGit(cwd)) {
    const entry: CacheEntry = { status: null, hasGit: false, timestamp: now };
    cacheByCwd.set(cwd, entry);
    return { hasGit: false, status: null };
  }

  const branch = getBranch(cwd);
  const aheadBehind = getAheadBehind(cwd);
  const dirty = getDirty(cwd);

  const status: GitStatus = {
    branch: branch ?? "HEAD",
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    dirty,
    hasUpstream: aheadBehind.hasUpstream,
  };

  cacheByCwd.set(cwd, { status, hasGit: true, timestamp: now });
  return { status, hasGit: true };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Fetch git status for cwd. Always synchronous and spawn-free on the render
 * path: fresh entries are served from cache, stale entries are served while
 * a background refresh runs, and cold misses serve a neutral fallback while
 * the backfill runs. Pass `force = true` for the explicit synchronous
 * query (used after branch change, never per frame).
 */
export function getGitStatus(cwd: string, force = false): { status: GitStatus | null; hasGit: boolean } {
  if (force) return queryGitSync(cwd);

  const now = Date.now();
  const hit = cacheByCwd.get(cwd);
  if (hit) {
    const ttl = hit.hasGit ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - hit.timestamp < ttl) {
      gitCacheStats.hits++;
      return { status: hit.status, hasGit: hit.hasGit };
    }
    // Stale: serve last-known-good, refresh off the event loop.
    gitCacheStats.staleServes++;
    refreshGitAsync(cwd);
    return { status: hit.status, hasGit: hit.hasGit };
  }

  // Cold: neutral fallback, backfill off the event loop.
  gitCacheStats.misses++;
  refreshGitAsync(cwd);
  return { hasGit: false, status: null };
}

/**
 * Invalidate git cache - call when branch changes.
 * With no argument clears everything; with cwd clears one entry and its
 * refresh throttle so the next frame backfills immediately.
 */
export function invalidateGitCache(cwd?: string): void {
  gitCacheStats.invalidations++;
  if (cwd) {
    cacheByCwd.delete(cwd);
    lastAttemptByCwd.delete(cwd);
  } else {
    cacheByCwd.clear();
    lastAttemptByCwd.clear();
  }
}
