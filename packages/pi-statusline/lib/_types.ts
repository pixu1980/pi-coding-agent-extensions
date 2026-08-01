/**
 * pi-statusline — Types & Constants
 */

// ── Statusline Data ────────────────────────────────────────────

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: number;
  hasUpstream: boolean;
}

export interface StatusLineData {
  project: string;
  git: GitStatus | null;
  hasGit: boolean;
  model: string;
  modelContext: number;
  effort: string;
  contextUsed: number;
  contextTotal: number;
  contextPct: number;
  initialPrompt: string;
}

// ── Settings ───────────────────────────────────────────────────

export type FormatPreset = "preset-auto" | "preset-full" | "preset-compact" | "preset-minimal" | "custom";
export type ProjectStyle = "git-relative" | "dirname";

export interface StatusLineSettings {
  format: FormatPreset;
  customTemplate: string;
  showProject: boolean;
  showBranch: boolean;
  showGitStatus: boolean;
  showModel: boolean;
  showEffort: boolean;
  showContext: boolean;
  projectStyle: ProjectStyle;
}

export const DEFAULT_SETTINGS: StatusLineSettings = {
  format: "preset-auto",
  customTemplate:
    "{project} | {branch} {git_status} | {model} - {effort} | {context}",
  showProject: true,
  showBranch: true,
  showGitStatus: true,
  showModel: true,
  showEffort: true,
  showContext: true,
  projectStyle: "git-relative",
};

// ── Preset Templates ───────────────────────────────────────────

export const PRESET_TEMPLATES: Record<Exclude<FormatPreset, "custom">, string> = {
  // preset-auto resolves to the responsive cascade (see RESPONSIVE_LEVELS);
  // this entry is only the fallback/verbose anchor for resolveTemplate.
  "preset-auto":
    "P: {project} › B: {branch} S: {git_status} › M: {model} E: {effort} › C: {context}",
  "preset-full":
    "P: {project} › B: {branch} S: {git_status} › M: {model} ({context_total}) E: {effort} › C: {context}",
  "preset-compact":
    "P: {project} › B: {branch} S: {git_status} › M: {model} E: {effort} › C: {context}",
  "preset-minimal":
    "{project} | {branch} {git_status} | {model} - {effort} | {context}",
};

// ── Responsive cascade (preset-auto) ──────────────────────────
// On every re-render the widget picks the most verbose level that fits the
// available width, falling back to more compact forms:
//
//   level 1 (verbose): P: ~/…/pi-coding-agent-extensions › B: main › M: … E: High › C: 0/1.0M (0%)
//   level 2 (compact): P: pi-coding-agent-extensions › B: main › M: … - High › C: 0/1.0M
//   level 3 (minimal): pi-coding-agent-extensions | main | … - High | 0/1.0M
//
// Levels 2–3 use the bare project name (dirname) instead of the full path.
export const RESPONSIVE_LEVELS: readonly string[] = [
  "P: {project} › B: {branch} S: {git_status} › M: {model} E: {effort} › C: {context}",
  "P: {project} › B: {branch} S: {git_status} › M: {model} - {effort} › C: {context_used}/{context_total}",
  "{project} | {branch} {git_status} | {model} - {effort} | {context_used}/{context_total}",
];

// ── Template Tokens ───────────────────────────────────────────
// All valid tokens for custom templates:
//   {project}        – project name/path
//   {branch}         – current git branch
//   {git_status}     – ahead/behind/dirty (e.g. ⇡6 !1)
//   {git_ahead}      – commits ahead
//   {git_behind}     – commits behind
//   {git_dirty}      – modified files count
//   {model}          – model name (e.g. Opus 4.8)
//   {effort}         – thinking/effort level (e.g. xHigh)
//   {context}        – used/total (pct)  (e.g. 901k/1M (90%))
//   {context_used}   – tokens used
//   {context_total}  – context window size
//   {context_pct}    – percentage only (e.g. 90%)
//   {initial_prompt} – first 60 chars of the session's first user message

export const KNOWN_TOKENS = [
  "project",
  "branch",
  "git_status",
  "git_ahead",
  "git_behind",
  "git_dirty",
  "model",
  "effort",
  "context",
  "context_used",
  "context_total",
  "context_pct",
  "initial_prompt",
] as const;

export type TokenName = (typeof KNOWN_TOKENS)[number];
