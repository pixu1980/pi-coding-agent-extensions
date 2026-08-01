/**
 * pi-statusline — internal helpers (private module)
 *
 * Pure helpers for the status line: effort labels/emojis, display width
 * estimation and project path resolution.
 */

import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

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

export function getProjectPath(cwd: string, style: string): string {
  const home = os.homedir();

  if (style === "dirname") return path.basename(cwd);

  try {
    const root = execSync("git rev-parse --show-toplevel 2>/dev/null", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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
  } catch {
    const rel = path.relative(home, cwd);
    if (rel && !rel.startsWith("..")) return "~/" + rel;
    return path.basename(cwd);
  }
}
