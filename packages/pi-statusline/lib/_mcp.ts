/**
 * pi-statusline - MCP server info (private module)
 *
 * Reads the number of configured/connected MCP servers from the agent dir,
 * with a short TTL cache.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface McpInfo {
  total: number;
  connected: number;
}

let mcpCache: { data: McpInfo; ts: number } | null = null;
const MCP_CACHE_TTL_MS = 5000;

export function getMcpInfo(): McpInfo {
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
