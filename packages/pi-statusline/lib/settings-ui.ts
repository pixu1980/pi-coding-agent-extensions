/**
 * pi-statusline — Settings UI
 *
 * Interactive settings panel using SettingsList.
 * Opened via `/statusline settings` command.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { DEFAULT_SETTINGS, type StatusLineSettings, type FormatPreset, type ProjectStyle } from "./types.js";
import { validateTemplate } from "./template.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Settings Persistence ───────────────────────────────────────

function settingsPath(): string {
  // Store in global pi agent config dir for cross-project persistence
  const agentDir = getAgentDir();
  return path.join(agentDir, "pi-statusline.json");
}

export function loadSettings(): StatusLineSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: StatusLineSettings): void {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf-8");
}

// ── Settings Panel ─────────────────────────────────────────────

export async function openSettingsPanel(ctx: ExtensionCommandContext): Promise<void> {
  const settings = loadSettings();

  const items: SettingItem[] = [
    {
      id: "format",
      label: "Format",
      currentValue: settings.format,
      values: ["preset-full", "preset-compact", "preset-minimal", "custom"] as FormatPreset[],
    },
    {
      id: "projectStyle",
      label: "Project path style",
      currentValue: settings.projectStyle,
      values: ["git-relative", "dirname"] as ProjectStyle[],
    },
    { id: "showProject", label: "Show project", currentValue: onoff(settings.showProject), values: ["on", "off"] },
    { id: "showBranch", label: "Show branch", currentValue: onoff(settings.showBranch), values: ["on", "off"] },
    { id: "showGitStatus", label: "Show git status", currentValue: onoff(settings.showGitStatus), values: ["on", "off"] },
    { id: "showModel", label: "Show model", currentValue: onoff(settings.showModel), values: ["on", "off"] },
    { id: "showEffort", label: "Show effort level", currentValue: onoff(settings.showEffort), values: ["on", "off"] },
    { id: "showContext", label: "Show context usage", currentValue: onoff(settings.showContext), values: ["on", "off"] },
  ];

  await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
    const container = new Container();

    // Header
    container.addChild(new Text(theme.fg("accent", theme.bold(" Statusline Settings")), 1, 0));
    container.addChild(new Text(theme.fg("dim", " ↑↓ navigate • space/enter toggle • esc close"), 1, 0));
    container.addChild(new Text("", 0, 0)); // spacer

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 4, 14),
      getSettingsListTheme(),
      (id, newValue) => {
        applyChange(settings, id, newValue);
        saveSettings(settings);
      },
      () => done(undefined),
      { enableSearch: false },
    );

    container.addChild(settingsList);

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        settingsList.handleInput?.(data);
        _tui.requestRender();
      },
    };
  });
}

// ── Helpers ────────────────────────────────────────────────────

function onoff(b: boolean): string {
  return b ? "on" : "off";
}

function applyChange(settings: StatusLineSettings, id: string, value: string): void {
  switch (id) {
    case "format":
      settings.format = value as FormatPreset;
      break;
    case "projectStyle":
      settings.projectStyle = value as ProjectStyle;
      break;
    case "showProject":
      settings.showProject = value === "on";
      break;
    case "showBranch":
      settings.showBranch = value === "on";
      break;
    case "showGitStatus":
      settings.showGitStatus = value === "on";
      break;
    case "showModel":
      settings.showModel = value === "on";
      break;
    case "showEffort":
      settings.showEffort = value === "on";
      break;
    case "showContext":
      settings.showContext = value === "on";
      break;
  }

  // If switching to/from custom, prompt for template
  if (id === "format" && value === "custom" && !settings.customTemplate) {
    // Will be prompted via input in the UI; for now use default
    settings.customTemplate = settings.customTemplate || "{project} | {branch} {git_status} | {model} - {effort} | {context}";
  }
}
