/**
 * pi-reasoning — internal constants and types (private module)
 */

/**
 * Thinking levels as defined by pi.dev.
 * This is the canonical order — matches what pi.dev exposes via
 * model.thinkingLevelMap and SHIFT+TAB native autocomplete.
 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ModelMapEntry {
  /** Substring to match against the model ID. Case-insensitive. */
  pattern: string;
  /** Thinking level to apply when this pattern matches */
  level: ThinkingLevel;
  /** Optional provider filter */
  providers?: string[];
}

// ── Default Mappings ───────────────────────────────────────────────
//
// Maps model ID substrings to thinking levels. Entries are checked in
// order; the FIRST match wins. More specific patterns first.

export const DEFAULT_MODEL_MAP: ModelMapEntry[] = [
  // ── Max reasoning ──────────────────────────────────────────
  { pattern: "claude-opus-4", level: "max" },
  { pattern: "claude-opus-3", level: "max" },
  { pattern: "o3", level: "max" },
  { pattern: "o4", level: "max" },
  { pattern: "deepseek-r1", level: "max" },

  // ── High reasoning ─────────────────────────────────────────
  { pattern: "claude-sonnet-4-5", level: "high" },
  { pattern: "claude-sonnet-4", level: "high" },
  { pattern: "gpt-5", level: "high" },
  { pattern: "gemini-2.5", level: "high" },
  { pattern: "gemini-3", level: "high" },
  { pattern: "deepseek", level: "high" },
  { pattern: "kimi", level: "high" },
  { pattern: "qwq", level: "high" },

  // ── Medium reasoning ───────────────────────────────────────
  { pattern: "claude-sonnet-3", level: "medium" },
  { pattern: "claude-3-sonnet", level: "medium" },
  { pattern: "gemini-2.0-pro", level: "medium" },
  { pattern: "llama-4", level: "medium" },
  { pattern: "llama-3", level: "medium" },
  { pattern: "mistral-large", level: "medium" },
  { pattern: "codestral", level: "medium" },

  // ── Low reasoning ──────────────────────────────────────────
  { pattern: "gpt-4o-mini", level: "low" },
  { pattern: "gemini-2.0-flash-lite", level: "low" },
  { pattern: "gemini-2.0-flash", level: "low" },
  { pattern: "mistral-small", level: "low" },

  // ── Minimal reasoning ──────────────────────────────────────
  { pattern: "claude-haiku", level: "low" },
  { pattern: "claude-3-haiku", level: "low" },
  { pattern: "gpt-4.1-mini", level: "minimal" },

  // ── Off ────────────────────────────────────────────────────
  { pattern: "gpt-4.1-nano", level: "off" },
  { pattern: "gpt-4-mini", level: "off" },

  // ── Broader patterns (after specific variants) ─────────────
  { pattern: "gpt-4o", level: "medium" },
  { pattern: "gpt-4.1", level: "medium" },
  { pattern: "gpt-4", level: "medium" },
  { pattern: "gemini-2.0", level: "medium" },
];

/**
 * All thinking levels in canonical order (matches pi.dev).
 */
export const ALL_THINKING_LEVELS: ThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

/** Levels enabled by pi.dev when a map key is omitted. */
export const STANDARD_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high",
];

/** Emoji mapping requested for pi-reasoning menus and status. */
export const LEVEL_EMOJI: Record<ThinkingLevel, string> = {
  off: "⚪",
  minimal: "💚",
  low: "💛",
  medium: "🧡",
  high: "❤️",
  xhigh: "❤️‍🔥",
  max: "🔥",
};

export type ReasoningModelCapabilities = {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null | undefined>;
};

/** Status bar key used for the reasoning indicator. */
export const STATUS_KEY = "reasoning";
