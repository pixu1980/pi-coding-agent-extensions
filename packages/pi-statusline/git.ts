/**
 * pi-statusline — Git status detection
 *
 * Uses execSync for synchronous git queries with a lightweight TTL cache
 * to avoid running git commands on every TUI render.
 */

import { execSync } from "node:child_process";
import type { GitStatus } from "./types.js";

// ── Cache ──────────────────────────────────────────────────────

interface CacheEntry {
  status: GitStatus | null;
  hasGit: boolean;
  timestamp: number;
  branch: string | null;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 2000; // recompute at most every 2s

// ── Helpers ────────────────────────────────────────────────────

function run(cmd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function hasGit(cwd: string): boolean {
  const out = run("git rev-parse --is-inside-work-tree 2>/dev/null");
  return out === "true";
}

function getBranch(): string | null {
  const out = run("git rev-parse --abbrev-ref HEAD 2>/dev/null");
  if (!out || out === "HEAD") return null;
  return out;
}

function getAheadBehind(): { ahead: number; behind: number; hasUpstream: boolean } {
  const out = run("git rev-list --count --left-right @{upstream}...HEAD 2>/dev/null");
  if (!out) return { ahead: 0, behind: 0, hasUpstream: false };
  const parts = out.split("\t");
  if (parts.length !== 2) return { ahead: 0, behind: 0, hasUpstream: false };
  return {
    ahead: parseInt(parts[1] ?? "0", 10) || 0,
    behind: parseInt(parts[0] ?? "0", 10) || 0,
    hasUpstream: true,
  };
}

function getDirty(): number {
  const out = run("git status --porcelain 2>/dev/null");
  if (!out) return 0;
  return out.split("\n").filter(Boolean).length;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Fetch git status for cwd. Results are cached per branch for CACHE_TTL_MS.
 * Pass `force = true` to bypass cache (used after branch change).
 */
export function getGitStatus(cwd: string, force = false): { status: GitStatus | null; hasGit: boolean } {
  const currentBranch = getBranch();

  // Return cached if still fresh and same branch
  if (!force && cache && cache.timestamp > Date.now() - CACHE_TTL_MS && cache.branch === currentBranch) {
    return { status: cache.status, hasGit: cache.hasGit };
  }

  if (!hasGit(cwd)) {
    cache = { status: null, hasGit: false, timestamp: Date.now(), branch: null };
    return { hasGit: false, status: null };
  }

  const aheadBehind = getAheadBehind();
  const dirty = getDirty();

  const status: GitStatus = {
    branch: currentBranch ?? "HEAD",
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    dirty,
    hasUpstream: aheadBehind.hasUpstream,
  };

  cache = { status, hasGit: true, timestamp: Date.now(), branch: status.branch };
  return { status, hasGit: true };
}

/**
 * Invalidate git cache — call when branch changes.
 */
export function invalidateGitCache(): void {
  cache = null;
}
