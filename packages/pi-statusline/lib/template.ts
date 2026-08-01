/**
 * pi-statusline — Template parser & compiler
 *
 * Known tokens (13):
 *   {project} {branch} {git_status} {git_ahead} {git_behind} {git_dirty}
 *   {model} {effort} {context} {context_used} {context_total} {context_pct}
 *   {initial_prompt}
 *
 * Colors: labels/separators = dim grey, values = section color, C: = gradient.
 */

import type { StatusLineData, StatusLineSettings } from "./types.js";
import { PRESET_TEMPLATES, KNOWN_TOKENS } from "./types.js";
import { gradient, fmtTokens } from "./colors.js";

// ── ANSI constants ─────────────────────────────────────────────

const DIM = "\x1b[38;2;140;140;140m";
const R = "\x1b[0m";

const VAL: Record<string, string> = {
  project: "\x1b[38;2;100;200;255m",   // cyan-blue
  branch: "\x1b[38;2;180;150;255m",    // lavender
  git_status: "\x1b[38;2;160;160;160m",// grey
  git_ahead: "\x1b[38;2;160;160;160m",
  git_behind: "\x1b[38;2;160;160;160m",
  git_dirty: "\x1b[38;2;160;160;160m",
  model: "\x1b[38;2;255;180;100m",     // orange-gold
  effort: "\x1b[38;2;180;220;100m",    // lime-green
  context: "",                          // gradient (handled after)
  context_used: "",
  context_total: "",
  context_pct: "",
  initial_prompt: "\x1b[38;2;200;200;200m", // off-white
};

const CTX_TOKEN = new Set(["context", "context_used", "context_total", "context_pct"]);

// ── Token pattern ──────────────────────────────────────────────
const TOKEN_PATTERN = /\{(\w+)\}/g;

export function validateTemplate(template: string): string | null {
  const seen = new Set<string>();
  const re = new RegExp(TOKEN_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const tok = m[1]!;
    seen.add(tok);
  }
  for (const t of seen) {
    if (!(KNOWN_TOKENS as readonly string[]).includes(t)) {
      return `Unknown token: {${t}}. Valid: ${KNOWN_TOKENS.map((x) => `{${x}}`).join(", ")}`;
    }
  }
  return null;
}

export function resolveTemplate(settings: StatusLineSettings): string {
  if (settings.format !== "custom") return PRESET_TEMPLATES[settings.format];
  return settings.customTemplate || PRESET_TEMPLATES["preset-compact"];
}

// ── Token resolvers ────────────────────────────────────────────

function fmtGit(data: StatusLineData): string {
  if (!data.hasGit || !data.git) return "";
  const p: string[] = [];
  if (data.git.hasUpstream && data.git.ahead > 0) p.push(`⇡${data.git.ahead}`);
  if (data.git.hasUpstream && data.git.behind > 0) p.push(`⇣${data.git.behind}`);
  if (data.git.dirty > 0) p.push(`!${data.git.dirty}`);
  return p.join(" ");
}

const OPTIONAL = new Set(["branch","git_status","git_ahead","git_behind","git_dirty"]);

function resolveToken(token: string, data: StatusLineData): string {
  switch (token) {
    case "project": return data.project;
    case "branch": return data.git?.branch ?? "";
    case "git_status": return fmtGit(data);
    case "git_ahead": return data.git && data.git.ahead > 0 ? String(data.git.ahead) : "";
    case "git_behind": return data.git && data.git.behind > 0 ? String(data.git.behind) : "";
    case "git_dirty": return data.git && data.git.dirty > 0 ? String(data.git.dirty) : "";
    case "model": return data.model;
    case "effort": return data.effort;
    case "context": return `${fmtTokens(data.contextUsed)}/${fmtTokens(data.contextTotal)} (${data.contextPct}%)`;
    case "context_used": return fmtTokens(data.contextUsed);
    case "context_total": return fmtTokens(data.contextTotal);
    case "context_pct": return `${data.contextPct}%`;
    case "initial_prompt": return data.initialPrompt;
    default: return `{${token}}`;
  }
}

// ── Segment types ──────────────────────────────────────────────

type CompiledTemplate = (data: StatusLineData) => string;

interface StaticSeg { type: "static"; text: string }
interface TokenSeg { type: "token"; name: string; optional: boolean }
type Segment = StaticSeg | TokenSeg;

type RenderOp =
  | { kind: "static"; text: string }
  | { kind: "required-token"; name: string }
  | { kind: "optional-token"; name: string; decorator: string };

// ── Compile ────────────────────────────────────────────────────

export function compileTemplate(template: string): CompiledTemplate | string {
  const err = validateTemplate(template);
  if (err) return err;

  // Phase 1: parse
  const segs: Segment[] = [];
  let last = 0;
  const re = new RegExp(TOKEN_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) segs.push({ type: "static", text: template.slice(last, m.index) });
    const name = m[1]!;
    segs.push({ type: "token", name, optional: OPTIONAL.has(name) });
    last = m.index + m[0].length;
  }
  if (last < template.length) segs.push({ type: "static", text: template.slice(last) });

  // Phase 2: build ops
  const ops: RenderOp[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.type === "static") {
      const next = segs[i + 1];
      if (next && next.type === "token" && next.optional) {
        ops.push({ kind: "optional-token", name: next.name, decorator: s.text });
        i++;
      } else {
        ops.push({ kind: "static", text: s.text });
      }
    } else if (s.type === "token") {
      if (s.optional) {
        ops.push({ kind: "optional-token", name: s.name, decorator: "" });
      } else {
        ops.push({ kind: "required-token", name: s.name });
      }
    }
  }

  // Phase 3: return render function with inline coloring
  // Strategy:
  //   - All static/decorator text → dim grey
  //   - Token values → their VAL color (except context tokens → left plain for gradient)
  //   - Context tokens → colored with gradient AFTER all rendering
  return (data: StatusLineData): string => {
    const out: string[] = [];
    for (const op of ops) {
      switch (op.kind) {
        case "static":
          out.push(DIM + op.text + R);
          break;
        case "required-token": {
          const val = resolveToken(op.name, data);
          const c = VAL[op.name];
          if (c && !CTX_TOKEN.has(op.name)) {
            out.push(c + val + R);
          } else {
            // context tokens: emit raw value for later gradient coloring
            out.push(val);
          }
          break;
        }
        case "optional-token": {
          const val = resolveToken(op.name, data);
          if (val) {
            out.push(DIM + op.decorator + R);
            const c = VAL[op.name];
            if (c && !CTX_TOKEN.has(op.name)) {
              out.push(c + val + R);
            } else {
              out.push(val);
            }
          }
          // empty → skip decorator + value entirely
          break;
        }
      }
    }
    return out.join("");
  };
}

// ── Post-render cleanup ────────────────────────────────────────

const CLEANUP: Array<[RegExp, string]> = [
  [/^\s*[›|]\s+/, ""],
  [/\s+[›|]\s*$/, ""],
  [/\s+[›|]\s+[›|]\s+/g, " › "],
  [/\s*\(\s*\)/g, ""],
  [/\x1b\[0m\s+\x1b\[38;2;140;140;140m/g, " "], // merge reset+dim gaps
  [/\x1b\[38;2;140;140;140m\s+\x1b\[0m/g, " "],
  [/\s{2,}/g, " "],
];

function cleanup(text: string): string {
  for (const [re, rep] of CLEANUP) text = text.replace(re, rep as string);
  return text.trim();
}

// ── Gradient for context ───────────────────────────────────────

export function applyColors(text: string, data: StatusLineData): string {
  const fullCtx = `${fmtTokens(data.contextUsed)}/${fmtTokens(data.contextTotal)} (${data.contextPct}%)`;
  if (text.includes(fullCtx)) {
    const idx = text.indexOf(fullCtx);
    return text.slice(0, idx) + gradient(fullCtx, data.contextPct / 100) + text.slice(idx + fullCtx.length);
  }
  const pctStr = `${data.contextPct}%`;
  if (text.includes(pctStr)) {
    const idx = text.indexOf(pctStr);
    return text.slice(0, idx) + gradient(pctStr, data.contextPct / 100) + text.slice(idx + pctStr.length);
  }
  return text;
}

// ── Public pipeline ────────────────────────────────────────────

export function renderStatusLine(data: StatusLineData, compiled: CompiledTemplate): string {
  const raw = compiled(data);
  const cleaned = cleanup(raw);
  return applyColors(cleaned, data);
}
