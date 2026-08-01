/**
 * pi-statusline — @pixu1980/pi-statusline
 *
 * Dual-line status display for pi-coding-agent:
 *   Line 1 (widget, below editor): project, git branch/status, model info,
 *                                  thinking level, and context usage with gradient.
 *   Line 2 (footer, replaces native): MCP server status on the left,
 *                                      provider/model info on the right.
 *
 * Commands:
 *   /statusline           – Print current statusline in output
 *   /statusline settings  – Open interactive settings panel
 *   /statusline template  – Set custom template string
 *   /statusline reload    – Reload settings from disk
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

import type { StatusLineData, StatusLineSettings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { getGitStatus, invalidateGitCache } from "./git.js";
import {
  resolveTemplate,
  compileTemplate,
  renderStatusLine,
  validateTemplate,
} from "./template.js";
import { loadSettings, saveSettings, openSettingsPanel } from "./settings-ui.js";

// ── Module-level state ─────────────────────────────────────────

let settings: StatusLineSettings = { ...DEFAULT_SETTINGS };
let cachedTmpl: string | null = null;
let compiledRender: ((data: StatusLineData) => string) | null = null;
let compileError: string | null = null;

// ── MCP info cache ────────────────────────────────────────────

interface McpInfo {
  total: number;
  connected: number;
}

let mcpCache: { data: McpInfo; ts: number } | null = null;
const MCP_CACHE_TTL_MS = 5000;

function getMcpInfo(): McpInfo {
  if (mcpCache && Date.now() - mcpCache.ts < MCP_CACHE_TTL_MS) {
    return mcpCache.data;
  }

  const agentDir = getAgentDir();
  const mcpConfigPath = path.join(agentDir, "mcp.json");
  const mcpCachePath = path.join(agentDir, "mcp-cache.json");

  let total = 0;
  let connected = 0;

  try {
    const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
    total = Object.keys(config.mcpServers || {}).length;
  } catch { /* mcp.json not found */ }

  try {
    const cache = JSON.parse(fs.readFileSync(mcpCachePath, "utf-8"));
    const servers: Record<string, any> = cache.servers || {};
    connected = Object.values(servers).filter(
      (s) => Array.isArray(s.tools) && s.tools.length > 0,
    ).length;
  } catch { /* cache not found */ }

  const data = { total, connected };
  mcpCache = { data, ts: Date.now() };
  return data;
}

function getEffortEmoji(level: string): string {
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

function estWidth(s: string): number {
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

// ── Line 1 helpers (template-based statusline) ─────────────────

function getProjectPath(cwd: string, style: string): string {
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

function getEffortLabel(level: string): string {
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

function computeContextUsage(ctx: ExtensionCommandContext): { used: number; total: number; pct: number } {
  const total = ctx.model?.contextWindow ?? 200_000;
  let used = 0;
  try {
    const usage = ctx.getContextUsage();
    if (usage?.tokens) used = usage.tokens;
  } catch { /* older pi */ }
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return { used, total, pct };
}

function buildData(ctx: ExtensionCommandContext): StatusLineData {
  const { status: git, hasGit } = getGitStatus(ctx.cwd);
  const usage = computeContextUsage(ctx);

  let initialPrompt = "";
  try {
    for (const e of ctx.sessionManager.getBranch()) {
      if (e.type === "message" && (e as any).message?.role === "user") {
        const msg = (e as any).message;
        const texts: string[] = [];
        for (const c of msg.content ?? []) {
          if (c?.type === "text" && typeof c?.text === "string") texts.push(c.text);
        }
        const text = texts.join(" ");
        if (text) initialPrompt = text.length > 72 ? text.slice(0, 72) + "..." : text;
        break;
      }
    }
  } catch { /* session not available */ }

  return {
    project: getProjectPath(ctx.cwd, settings.projectStyle),
    git,
    hasGit,
    model: ctx.model?.name ?? (ctx.model as any)?.id ?? "?",
    modelContext: ctx.model?.contextWindow ?? 0,
    effort: getEffortLabel(ctx.thinkingLevel),
    contextUsed: usage.used,
    contextTotal: usage.total,
    contextPct: usage.pct,
    initialPrompt,
  };
}

function formatLine(ctx: ExtensionCommandContext, overrideTmpl?: string): string {
  const data = buildData(ctx);
  const tmpl = overrideTmpl ?? resolveTemplate(settings);

  if (cachedTmpl !== tmpl || !compiledRender || compileError) {
    const result = compileTemplate(tmpl);
    if (typeof result === "string") {
      compileError = result;
      compiledRender = null;
    } else {
      compiledRender = result;
      compileError = null;
      cachedTmpl = tmpl;
    }
  }

  if (!compiledRender) return compileError ?? "! template error";
  return renderStatusLine(data, compiledRender);
}

// ── Extension ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  settings = loadSettings();

  // ── Line 1: Widget (below editor) ───────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // eslint-disable-next-line no-console
    console.error(
      "[pi-statusline] Loaded — format:",
      settings.format,
      "projectStyle:",
      settings.projectStyle,
    );

    // Widget: template-based statusline (project, git, model, context)
    ctx.ui.setWidget(
      "pi-statusline",
      (_tui, _theme) => ({
        render(): string[] {
          const line = formatLine(ctx);
          return [line];
        },
        invalidate() {
          cachedTmpl = null;
          compiledRender = null;
          compileError = null;
        },
      }),
      { placement: "belowEditor" },
    );

    // Footer: MCP info (left) + provider/model (right)
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          try {
            const mcp = getMcpInfo();
            const effort = ctx.thinkingLevel || "high";
            const effortEmoji = getEffortEmoji(effort);

            const leftRaw = `🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ${effortEmoji} ${effort}`;
            const left = theme.fg("dim", leftRaw);

            const modelObj = ctx.model;
            const provider = (modelObj as any)?.provider ?? "?";
            const modelName = modelObj?.name ?? (modelObj as any)?.id ?? "?";
            const rightRaw = `(${provider}) ${modelName} • ${effort}`;
            const right = theme.fg("dim", rightRaw);

            const leftW = estWidth(left);
            const rightW = estWidth(right);
            const padLen = Math.max(1, width - leftW - rightW);
            const line = left + " ".repeat(padLen) + right;

            if (estWidth(line) > width) return [leftRaw + "  " + rightRaw];
            return [line];
          } catch {
            return ["pi-statusline"];
          }
        },
      };
    });
  });

  // Refresh on model/thinking changes
  pi.on("model_select", async (_event, ctx) => {
    // Re-set footer with updated ctx
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          try {
            const mcp = getMcpInfo();
            const effort = ctx.thinkingLevel || "high";
            const effortEmoji = getEffortEmoji(effort);
            const leftRaw = `🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ${effortEmoji} ${effort}`;
            const left = theme.fg("dim", leftRaw);
            const modelObj = ctx.model;
            const provider = (modelObj as any)?.provider ?? "?";
            const modelName = modelObj?.name ?? (modelObj as any)?.id ?? "?";
            const rightRaw = `(${provider}) ${modelName} • ${effort}`;
            const right = theme.fg("dim", rightRaw);
            const leftW = estWidth(left);
            const rightW = estWidth(right);
            const padLen = Math.max(1, width - leftW - rightW);
            const line = left + " ".repeat(padLen) + right;
            if (estWidth(line) > width) return [leftRaw + "  " + rightRaw];
            return [line];
          } catch {
            return ["pi-statusline"];
          }
        },
      };
    });
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          try {
            const mcp = getMcpInfo();
            const effort = ctx.thinkingLevel || "high";
            const effortEmoji = getEffortEmoji(effort);
            const leftRaw = `🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ${effortEmoji} ${effort}`;
            const left = theme.fg("dim", leftRaw);
            const modelObj = ctx.model;
            const provider = (modelObj as any)?.provider ?? "?";
            const modelName = modelObj?.name ?? (modelObj as any)?.id ?? "?";
            const rightRaw = `(${provider}) ${modelName} • ${effort}`;
            const right = theme.fg("dim", rightRaw);
            const leftW = estWidth(left);
            const rightW = estWidth(right);
            const padLen = Math.max(1, width - leftW - rightW);
            const line = left + " ".repeat(padLen) + right;
            if (estWidth(line) > width) return [leftRaw + "  " + rightRaw];
            return [line];
          } catch {
            return ["pi-statusline"];
          }
        },
      };
    });
  });

  // ── /statusline command ──────────────────────────────────────

  pi.registerCommand("statusline", {
    description: "Show statusline or configure it (settings / template / reload)",
    async handler(args, ctx) {
      const sub = args?.trim();

      if (sub === "settings") {
        await openSettingsPanel(ctx);
        settings = loadSettings();
        cachedTmpl = null;
        compiledRender = null;
        return;
      }

      if (sub === "reload") {
        settings = loadSettings();
        cachedTmpl = null;
        compiledRender = null;
        ctx.ui.notify("Statusline settings reloaded", "info");
        return;
      }

      if (sub?.startsWith("template ")) {
        const tmpl = sub.slice("template ".length).trim();
        const err = validateTemplate(tmpl);
        if (err) {
          ctx.ui.notify(err, "error");
          return;
        }
        settings.format = "custom";
        settings.customTemplate = tmpl;
        saveSettings(settings);
        cachedTmpl = null;
        compiledRender = null;
        ctx.ui.notify(`Custom template set:\n${tmpl}`, "info");
        return;
      }

      // Default: print current status info
      const line = formatLine(ctx);
      const mcp = getMcpInfo();
      const effort = ctx.thinkingLevel || "high";
      const modelObj = ctx.model;
      const provider = (modelObj as any)?.provider ?? "?";
      const modelName = modelObj?.name ?? (modelObj as any)?.id ?? "?";
      ctx.ui.notify(
        `${line}\n🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ❤️ ${effort}` +
          `  |  (${provider}) ${modelName} • ${effort}`,
        "info",
      );
    },
  });
}
