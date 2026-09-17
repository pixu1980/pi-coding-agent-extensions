/**
 * pi-remote - paired-peer store (atomic peers.json)
 *
 * Record shape mirrors remote_pi (`{name, remote_epk, paired_at}`) so a
 * future migration path stays trivial. Writes are atomic (tmp + rename) so
 * a crash mid-pair never leaves a half-written store.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { piRemoteDir } from './_identity.ts';

export interface PeerRecord {
  /** Human label from the phone (`device_name` in pair_request). */
  name: string;
  /** Canonical peer id: standard-base64 Ed25519 pubkey, as routed by relay. */
  remote_epk: string;
  paired_at: string;
}

export function peersPath(dir: string = piRemoteDir()): string {
  return join(dir, 'peers.json');
}

export function loadPeers(dir: string = piRemoteDir()): PeerRecord[] {
  try {
    const raw = JSON.parse(readFileSync(peersPath(dir), 'utf8')) as { peers?: unknown };
    if (!raw || !Array.isArray(raw.peers)) return [];
    return raw.peers.filter(
      (p): p is PeerRecord => !!p && typeof p === 'object' && typeof (p as PeerRecord).remote_epk === 'string'
    );
  } catch {
    return [];
  }
}

function savePeers(dir: string, peers: PeerRecord[]): void {
  mkdirSync(dir, { recursive: true });
  const path = peersPath(dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, peers }, null, 2));
  renameSync(tmp, path);
}

/** Inserts or replaces a peer by `remote_epk`. */
export function addPeer(dir: string, record: PeerRecord): PeerRecord[] {
  const peers = loadPeers(dir).filter((p) => p.remote_epk !== record.remote_epk);
  peers.push(record);
  savePeers(dir, peers);
  return peers;
}

export function findPeer(dir: string, remoteEpk: string): PeerRecord | undefined {
  return loadPeers(dir).find((p) => p.remote_epk === remoteEpk);
}

/** Returns true when a record was actually removed. */
export function removePeer(dir: string, remoteEpk: string): boolean {
  const peers = loadPeers(dir);
  const kept = peers.filter((p) => p.remote_epk !== remoteEpk);
  if (kept.length === peers.length) return false;
  savePeers(dir, kept);
  return true;
}
