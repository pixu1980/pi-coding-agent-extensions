/**
 * pi-statusline — extension entry (factory)
 *
 * Dual-line status display: a template-based widget below the editor
 * (project, git, model, effort, context) and a footer with MCP server
 * status on the left and provider/model info on the right.
 *
 * Commands:
 *   /statusline           – Print current statusline in output
 *   /statusline settings  – Open interactive settings panel
 *   /statusline template  – Set custom template string
 *   /statusline reload    – Reload settings from disk
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { StatusLineData, StatusLineSettings } from "./_types.ts";
import { DEFAULT_SETTINGS } from "./_types.ts";
import { getGitStatus, invalidateGitCache } from "./_git.ts";
import {
  resolveTemplate,
  compileTemplate,
  renderStatusLine,
  renderResponsive,
  validateTemplate,
} from "./_template.ts";
import { loadSettings, saveSettings, openSettingsPanel } from "./_settings-ui.ts";
import { getProjectPath, getEffortLabel, getEffortEmoji, estWidth } from "./_helpers.ts";
import { getMcpInfo } from "./_mcp.ts";

// ── Module-level state ─────────────────────────────────────────

let settings: StatusLineSettings = { ...DEFAULT_SETTINGS };
let cachedTmpl: string | null = null;
let compiledRender: ((data: StatusLineData) => string) | null = null;
let compileError: string | null = null;

// ── Context usage ─────────────────────────────────────────────

function computeContextUsage(ctx: ExtensionContext): { used: number; total: number; pct: number } {
  const total = ctx.model?.contextWindow ?? 200_000;
  let used = 0;
  try {
    const usage = ctx.getContextUsage();
    if (usage?.tokens) used = usage.tokens;
  } catch { /* older pi */ }
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return { used, total, pct };
}

// ── Line 1: template-based statusline ─────────────────────────

function buildData(ctx: ExtensionContext): StatusLineData {
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
    effort: getEffortLabel(ctx.thinkingLevel || "high"),
    contextUsed: usage.used,
    contextTotal: usage.total,
    contextPct: usage.pct,
    initialPrompt,
  };
}

function formatLine(ctx: ExtensionContext, width?: number): string {
  const data = buildData(ctx);

  // Responsive mode: pick the most verbose level that fits the width.
  if (settings.format === "preset-auto") {
    return renderResponsive(data, width ?? 120);
  }

  const tmpl = resolveTemplate(settings);

  if (cachedTmpl !== tmpl || !compiledRender || compileError) {
    const result = compileTemplate(tmpl);
    if (typeof result === "string") {
      compileError = result;
      return result;
    }
    compileError = null;
    compiledRender = result;
    cachedTmpl = tmpl;
  }

  return renderStatusLine(data, compiledRender!);
}

// ── Footer renderer ───────────────────────────────────────────

function createFooter(ctx: ExtensionContext) {
  return (tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
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

          if (estWidth(line) > width) {
            return [truncateToWidth(leftRaw + "  " + rightRaw, Math.max(1, width))];
          }
          return [line];
        } catch {
          return ["pi-statusline"];
        }
      },
    };
  };
}

// ── Extension entry ───────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    // Widget: template-based statusline (project, git, model, context)
    ctx.ui.setWidget(
      "pi-statusline",
      (_tui, _theme) => ({
        render(width: number): string[] {
          const line = formatLine(ctx, width);
          return [truncateToWidth(line, Math.max(1, width))];
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
    ctx.ui.setFooter(createFooter(ctx));
  });

  // Refresh on model/thinking changes
  pi.on("model_select", async (_event, ctx) => {
    ctx.ui.setFooter(createFooter(ctx));
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    ctx.ui.setFooter(createFooter(ctx));
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
