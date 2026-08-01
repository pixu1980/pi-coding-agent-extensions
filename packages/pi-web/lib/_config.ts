/**
 * Optional configuration loaded from ~/.pi/pi-web.json. Example:
 *
 * ```json
 * {
 *   "userAgent": "my-custom-agent/1.0",
 *   "timeoutMs": 30000,
 *   "maxResponseBytes": 2097152,
 *   "maxChars": 12000,
 *   "concurrency": 3,
 *   "allowRanges": ["127.0.0.1", "::1"]
 * }
 * ```
 *
 * `allowRanges` is the SSRF allowlist: private/loopback addresses are blocked
 * by default, add entries (CIDR or literal IPs) to permit local development
 * servers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface PiWebConfig {
  userAgent: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxChars: number;
  concurrency: number;
  allowRanges: string[];
}

const DEFAULTS: PiWebConfig = {
  userAgent: "pi-web/0.1.0 (+https://github.com/pixu1980/pi-coding-agent-extensions)",
  timeoutMs: 30_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxChars: 12_000,
  concurrency: 3,
  allowRanges: [],
};

export function loadConfig(): PiWebConfig {
  const config: PiWebConfig = { ...DEFAULTS, allowRanges: [...DEFAULTS.allowRanges] };
  try {
    const raw = readFileSync(join(homedir(), ".pi", "pi-web.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.userAgent === "string") config.userAgent = parsed.userAgent;
    if (typeof parsed.timeoutMs === "number") config.timeoutMs = parsed.timeoutMs;
    if (typeof parsed.maxResponseBytes === "number") config.maxResponseBytes = parsed.maxResponseBytes;
    if (typeof parsed.maxChars === "number") config.maxChars = parsed.maxChars;
    if (typeof parsed.concurrency === "number") config.concurrency = parsed.concurrency;
    if (Array.isArray(parsed.allowRanges)) {
      config.allowRanges = parsed.allowRanges.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // no config file (or unreadable) → defaults
  }
  return config;
}
