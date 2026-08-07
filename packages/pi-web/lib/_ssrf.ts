/**
 * SSRF guard: by default block requests to private/reserved/link-local
 * addresses so a prompt-injected URL cannot exfiltrate internal services.
 * The allowlist (CIDR or literal IPs) re-opens specific ranges, e.g.
 * `["127.0.0.1", "::1"]` for local development servers.
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

interface IpRange {
  family: 4 | 6;
  network: bigint;
  bits: number;
}

/** Always blocked unless explicitly allowlisted. */
const DEFAULT_BLOCKED: string[] = [
  // IPv4 - private, loopback, link-local, CGNAT, documentation, multicast, reserved
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  // IPv6 - unspecified, loopback, ULA, link-local, multicast, v4-mapped
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "::ffff:0:0/96",
];

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(ip: string): bigint | null {
  let addr = ip;
  let embeddedV4: bigint | null = null;
  const lastColon = addr.lastIndexOf(":");
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes(".")) {
    embeddedV4 = parseIpv4(addr.slice(lastColon + 1));
    if (embeddedV4 === null) return null;
    addr = addr.slice(0, lastColon + 1) + "0:0";
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(missing).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  if (embeddedV4 !== null) {
    value = (value & ~0xffffffffn) | embeddedV4;
  }
  return value;
}

function parseRange(spec: string): IpRange | null {
  let ip = spec;
  let bits: number | null = null;
  const slash = spec.indexOf("/");
  if (slash !== -1) {
    ip = spec.slice(0, slash);
    const b = Number(spec.slice(slash + 1));
    if (!Number.isInteger(b) || b < 0) return null;
    bits = b;
  }
  if (isIP(ip) === 4) {
    const value = parseIpv4(ip);
    if (value === null) return null;
    return { family: 4, network: value, bits: bits ?? 32 };
  }
  if (isIP(ip) === 6) {
    const value = parseIpv6(ip);
    if (value === null) return null;
    return { family: 6, network: value, bits: bits ?? 128 };
  }
  return null;
}

function ipValue(ip: string): { family: 4 | 6; value: bigint } | null {
  const family = isIP(ip);
  if (family === 4) {
    const value = parseIpv4(ip);
    return value === null ? null : { family: 4, value };
  }
  if (family === 6) {
    const value = parseIpv6(ip);
    return value === null ? null : { family: 6, value };
  }
  return null;
}

function ipInRange(ip: string, range: IpRange): boolean {
  const parsed = ipValue(ip);
  if (parsed === null) return false;
  if (parsed.family !== range.family) {
    // A v4 address is covered by the v4-mapped prefix ::ffff:0:0/96.
    if (parsed.family === 4 && range.family === 6 && range.bits === 96 && range.network === 0xffffn << 96n) {
      return true;
    }
    return false;
  }
  const totalBits = range.family === 4 ? 32 : 128;
  const shift = BigInt(totalBits - range.bits);
  return (parsed.value >> shift) === (range.network >> shift);
}

export function isBlockedAddress(ip: string, allowRanges: string[]): boolean {
  const allow = allowRanges
    .map((spec) => parseRange(spec))
    .filter((r): r is IpRange => r !== null);
  if (allow.some((range) => ipInRange(ip, range))) return false;
  return DEFAULT_BLOCKED.some((spec) => {
    const range = parseRange(spec);
    return range !== null && ipInRange(ip, range);
  });
}

export async function hostnameAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  try {
    const result = await lookup(hostname, { all: true, verbatim: true });
    return result.map((entry) => entry.address);
  } catch {
    return [];
  }
}

export interface HostValidation {
  blocked: boolean;
  reason?: string;
  addresses: string[];
}

export async function validateTargetHost(hostname: string, allowRanges: string[]): Promise<HostValidation> {
  const addresses = await hostnameAddresses(hostname);
  if (addresses.length === 0) {
    return { blocked: true, reason: `Could not resolve host: ${hostname}`, addresses };
  }
  for (const address of addresses) {
    if (isBlockedAddress(address, allowRanges)) {
      return {
        blocked: true,
        reason: `Address ${address} is a private/reserved address (blocked by SSRF guard; add it to piWeb allowRanges to permit)`,
        addresses,
      };
    }
  }
  return { blocked: false, addresses };
}
