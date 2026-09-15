/**
 * pi-statusline - internal helpers (private module)
 *
 * Pure helpers for the status line: effort labels/emojis, display width
 * estimation and project path resolution.
 */

import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";

export function getEffortLabel(level: string): string {
  switch (level) {
    case "off": return "Off";
    case "minimal": return "Minimal";
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    case "xhigh": return "xHigh";
    case "max": return "Max";
    default: return level;
  }
}

export function getEffortEmoji(level: string): string {
  switch (level) {
    case "off": return "💤";
    case "minimal": return "💡";
    case "low": return "🔹";
    case "medium": return "🔶";
    case "high": return "❤️";
    case "xhigh": return "🔥";
    case "max": return "🚀";
    default: return "❤️";
  }
}

// ── Width estimator ───────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function estWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x1100 && (cp < 0x1160 || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f9ff) || (cp >= 0x1fa00 && cp <= 0x1fa6f))) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

// ── Project path ──────────────────────────────────────────────

// ── Project path (cached) ─────────────────────────────────────────
// getProjectPath runs on every TUI frame. Without a cache it spawns
// `git rev-parse` per frame and blocks the pi process. Cache per
// cwd+style: fresh hit = zero spawns.

const projectPathCache = new Map<string, { value: string; ts: number }>();
const toplevelCache = new Map<string, { root: string; ts: number }>();
const PROJECT_TTL_MS = 15000;
const TOPLEVEL_TTL_MS = 30000;
const REFRESH_TIMEOUT_MS = 1500;
const REFRESH_RETRY_MS = 2000;

// Single-flight background refreshes plus last-attempt throttle.
const pendingProjectRefreshes = new Map<string, Promise<void>>();
const scheduledProjectRefreshes = new Set<string>();
const lastProjectAttemptByCwd = new Map<string, number>();

// ── Cache counters (PERF-05) ─────────────────────────────────────
// TTL rationale: the project path only changes when the repo root or the
// cwd changes, so 15s freshness costs nothing visible while keeping the
// display honest; the toplevel lookup is even slower moving and gets 30s.

interface ProjectPathStats {
  hits: number;
  misses: number;
  staleServes: number;
}

const projectPathStats: ProjectPathStats = { hits: 0, misses: 0, staleServes: 0 };

export function getProjectPathStats(): ProjectPathStats {
  return { ...projectPathStats };
}

/**
 * Resolve the git toplevel without a shell; never throws.
 */
function toplevelAsync(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8", timeout: REFRESH_TIMEOUT_MS, cwd }, (error, stdout) => {
      if (error) resolve(null);
      else {
        const root = String(stdout).trim();
        resolve(root || null);
      }
    });
  });
}

/**
 * Format a project display path from a known toplevel. Pure and cheap.
 */
function formatProjectPath(cwd: string, root: string | null, home: string): string {
  if (!root) return path.basename(cwd);
  const rel = path.relative(root, cwd);
  let result: string;
  if (!rel || rel === ".") {
    result = path.basename(root);
  } else {
    result = `${path.basename(root)}/${rel}`;
  }
  if (root.startsWith(home)) {
    const rootRel = path.relative(home, root);
    result = "~" + (rootRel ? "/" + rootRel : "") + (rel && rel !== "." ? "/" + rel : "");
  }
  return result;
}

/**
 * Kick a single-flight background refresh for cwd. Safe to call per frame.
 * Spawn setup is deferred to `setImmediate` so the render call returns in
 * microseconds. Never rejects.
 */
function refreshProjectAsync(cwd: string): void {
  const now = Date.now();
  if (pendingProjectRefreshes.has(cwd) || scheduledProjectRefreshes.has(cwd)) return;
  if (now - (lastProjectAttemptByCwd.get(cwd) ?? 0) < REFRESH_RETRY_MS) return;
  lastProjectAttemptByCwd.set(cwd, now);
  scheduledProjectRefreshes.add(cwd);
  const timer = setImmediate(() => {
    scheduledProjectRefreshes.delete(cwd);
    if (pendingProjectRefreshes.has(cwd)) return;
    const home = os.homedir();
    // Reuse a fresh toplevel without spawning; otherwise resolve it async.
    const cachedRoot = toplevelCache.get(cwd);
    const rootPromise: Promise<string | null> =
      cachedRoot && Date.now() - cachedRoot.ts < TOPLEVEL_TTL_MS
        ? Promise.resolve(cachedRoot.root)
        : toplevelAsync(cwd).then((root) => {
            if (root) toplevelCache.set(cwd, { root, ts: Date.now() });
            return root;
          });
    const pending = Promise.all([
      rootPromise,
      // Canonicalize symlinked cwd (e.g. macOS /var -> /private/var) so the
      // relative display path never escapes into `..` segments.
      realpath(cwd).catch(() => cwd),
    ])
      .then(([root, realCwd]) => {
        const value = formatProjectPath(realCwd, root, home);
        projectPathCache.set(`${cwd}:git-relative`, { value, ts: Date.now() });
      })
      .catch(() => {
        // Inputs never throw; guard retained so refreshes stay silent.
      })
      .finally(() => {
        pendingProjectRefreshes.delete(cwd);
      });
    pendingProjectRefreshes.set(cwd, pending);
  });
  timer.unref();
}

/**
 * Await in-flight project-path refreshes. Diagnostic and test hook; render
 * code never needs it because reads always serve synchronously.
 *
 * @returns Promise that resolves when no refresh is in flight.
 */
export async function flushProjectPathRefreshes(): Promise<void> {
  // Yield past deferred kicks so a refresh scheduled this tick is visible.
  await new Promise((resolve) => setImmediate(resolve));
  const pending = [...pendingProjectRefreshes.values()];
  if (pending.length === 0) return;
  await Promise.all(pending);
  return flushProjectPathRefreshes();
}

export function invalidateProjectPathCache(cwd?: string): void {
  if (cwd) {
    projectPathCache.delete(`${cwd}:git-relative`);
    projectPathCache.delete(`${cwd}:dirname`);
    toplevelCache.delete(cwd);
    lastProjectAttemptByCwd.delete(cwd);
  } else {
    projectPathCache.clear();
    toplevelCache.clear();
    lastProjectAttemptByCwd.clear();
  }
}

/**
 * Resolve the project display path. Always synchronous and spawn-free:
 * fresh entries come from cache, stale entries are served while a
 * background refresh runs, and cold misses serve the bare dirname while
 * the backfill runs.
 */
export function getProjectPath(cwd: string, style: string): string {
  if (style === "dirname") return path.basename(cwd);

  // Fast path: fresh cache → zero spawns.
  const cacheKey = `${cwd}:git-relative`;
  const now = Date.now();
  const hit = projectPathCache.get(cacheKey);
  if (hit) {
    if (now - hit.ts < PROJECT_TTL_MS) {
      projectPathStats.hits++;
      return hit.value;
    }
    // Stale: serve last-known-good, refresh off the event loop.
    projectPathStats.staleServes++;
    refreshProjectAsync(cwd);
    return hit.value;
  }

  // Cold: bare-dirname fallback, backfill off the event loop.
  projectPathStats.misses++;
  refreshProjectAsync(cwd);
  return path.basename(cwd);
}
