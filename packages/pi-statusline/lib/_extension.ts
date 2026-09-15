/**
 * pi-statusline - extension entry (factory)
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
import { getGitStatus, invalidateGitCache, getGitCacheStats } from "./_git.ts";
import {
  resolveTemplate,
  compileTemplate,
  renderStatusLine,
  renderResponsive,
  validateTemplate,
} from "./_template.ts";
import { loadSettings, saveSettings, openSettingsPanel } from "./_settings-ui.ts";
import { getProjectPath, getEffortLabel, formatEffortLevel, estWidth, invalidateProjectPathCache, getProjectPathStats } from "./_helpers.ts";
import { getMcpInfo, getMcpStats } from "./_mcp.ts";

// ── Module-level state ─────────────────────────────────────────

let settings: StatusLineSettings = { ...DEFAULT_SETTINGS };
let cachedTmpl: string | null = null;
let compiledRender: ((data: StatusLineData) => string) | null = null;
let compileError: string | null = null;

// Memoized first-user-message: buildData runs per TUI frame, scanning the
// whole session branch each time would be O(n) per frame. The first message
// never changes unless the branch grows, so cache by branch length.
let cachedInitialPrompt = "";
let cachedBranchLen = -1;

// ── Context usage ─────────────────────────────────────────────

function computeContextUsage(ctx: ExtensionContext): { used: number; total: number; pct: number } {
  const total = ctx.model?.contextWindow ?? 200_000;
  let used = 0;

  try {
    const usage = ctx.getContextUsage();

    if (usage?.tokens) {
      used = usage.tokens;
    }
  } catch { /* older pi */ }

  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  return { used, total, pct };
}

// ── Line 1: template-based statusline ─────────────────────────

/** A branch entry whose `message` field this file reads. */
interface UserMessageEntry {
  message: { role?: string; content?: { type?: string; text?: string }[] };
}

/**
 * Narrow a branch entry to the message shape read below.
 *
 * @param entry - A session branch entry.
 * @returns `true` when the entry carries a message object.
 */
function isUserMessageEntry(entry: unknown): entry is UserMessageEntry {
  return typeof entry === "object" && entry !== null && "message" in entry;
}

function getInitialPrompt(ctx: ExtensionContext): string {
  try {
    const branch = ctx.sessionManager.getBranch();

    // Fast path: same length → first message unchanged, zero iteration.
    if (branch.length === cachedBranchLen) {
      return cachedInitialPrompt;
    }

    cachedBranchLen = branch.length;

    for (const e of branch) {
      if (e.type === "message" && isUserMessageEntry(e)) {
        const msg = e.message;
        const texts: string[] = [];

        for (const c of msg.content ?? []) {
          if (c?.type === "text" && typeof c?.text === "string") {
            texts.push(c.text);
          }
        }

        const text = texts.join(" ");

        cachedInitialPrompt = text ? (text.length > 72 ? text.slice(0, 72) + "..." : text) : "";

        return cachedInitialPrompt;
      }
    }

    cachedInitialPrompt = "";

    return cachedInitialPrompt;
  } catch {
    return cachedInitialPrompt;
  }
}

/**
 * The model's short id, when the context exposes one.
 *
 * @param model - The active model, of unknown shape at this boundary.
 * @returns The string id, or `undefined`.
 */
function modelIdOf(model: unknown): string | undefined {
  if (typeof model !== "object" || model === null || !("id" in model)) {
    return undefined;
  }

  return typeof model.id === "string" ? model.id : undefined;
}

/**
 * The model's provider label, when the context exposes one.
 *
 * @param model - The active model, of unknown shape at this boundary.
 * @returns The provider string, or `undefined`.
 */
function providerOf(model: unknown): string | undefined {
  if (typeof model !== "object" || model === null || !("provider" in model)) {
    return undefined;
  }

  return typeof model.provider === "string" ? model.provider : undefined;
}

function buildData(ctx: ExtensionContext): StatusLineData {
  const { status: git, hasGit } = getGitStatus(ctx.cwd);
  const usage = computeContextUsage(ctx);
  const initialPrompt = getInitialPrompt(ctx);

  return {
    project: getProjectPath(ctx.cwd, settings.projectStyle),
    git,
    hasGit,
    model: ctx.model?.name ?? modelIdOf(ctx.model) ?? "?",
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
    const unsub = footerData.onBranchChange(() => {
      // A branch change makes every cached git answer for this cwd stale:
      // drop the entry so the next render backfills the new branch, and the
      // project-path display (repo-relative) refreshes too.
      invalidateGitCache(ctx.cwd);
      invalidateProjectPathCache(ctx.cwd);
      tui.requestRender();
    });

    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        try {
          const mcp = getMcpInfo();
          const effort = ctx.thinkingLevel || "high";

          const leftRaw = `🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ${formatEffortLevel(effort)}`;
          const left = theme.fg("dim", leftRaw);

          const modelObj = ctx.model;
          const provider = providerOf(modelObj) ?? "?";
          const modelName = modelObj?.name ?? modelIdOf(modelObj) ?? "?";
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

      if (sub === "debug") {
        const git = getGitCacheStats();
        const project = getProjectPathStats();
        const mcp = getMcpStats();
        const rate = (n: { hits: number; misses: number; staleServes?: number }) => {
          const total = n.hits + n.misses + (n.staleServes ?? 0);

          return total === 0 ? "0%" : `${Math.round((n.hits / total) * 1000) / 10}%`;
        };

        ctx.ui.notify(
          `Cache debug\ngit cache: hits=${git.hits} misses=${git.misses} stale=${git.staleServes} invalidations=${git.invalidations} (hit rate ${rate(git)})\n` +
          `project cache: hits=${project.hits} misses=${project.misses} stale=${project.staleServes} (hit rate ${rate(project)})\n` +
          `mcp cache: hits=${mcp.hits} misses=${mcp.misses} (hit rate ${rate(mcp)})`,
          "info",
        );

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
      const provider = providerOf(modelObj) ?? "?";
      const modelName = modelObj?.name ?? modelIdOf(modelObj) ?? "?";

      ctx.ui.notify(
        `${line}\n🔌 MCP: ${mcp.total} servers enabled (${mcp.connected} connected) ${formatEffortLevel(effort)}` +
          `  |  (${provider}) ${modelName} • ${effort}`,
        "info",
      );
    },
  });
}
