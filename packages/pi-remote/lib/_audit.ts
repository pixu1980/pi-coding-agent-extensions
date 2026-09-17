/**
 * pi-remote - audit log (append-only JSONL)
 *
 * Records security-relevant lifecycle events (pairing, rejection, revoke,
 * relay connect/disconnect, push subscription changes) so the user can
 * answer "which phone paired, when, and is it still allowed?".
 *
 * Privacy: never stores tokens, message text or full peer ids — peers are
 * truncated to an 8-char prefix. One generation is kept (`audit.1.jsonl`)
 * once the active file passes `MAX_BYTES`. Appends never throw: auditing
 * must not break the control path.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { piRemoteDir } from './_identity.ts';

const MAX_BYTES = 512 * 1024;

export interface AuditEvent {
  ts: string;
  event:
    | 'start'
    | 'stop'
    | 'relay_connect'
    | 'relay_disconnect'
    | 'pair'
    | 'pair_reject'
    | 'revoke'
    | 'push_subscribe'
    | 'push_unsubscribe'
    | 'wake_push';
  /** Truncated peer id (8 chars) — never the full key. */
  peer?: string;
  /** Short, non-sensitive context (error code, room id, device name). */
  detail?: string;
}

export function auditPath(dir: string = piRemoteDir()): string {
  return join(dir, 'audit.jsonl');
}

/** Truncates a peer id for storage; keeps it correlatable, not identifying. */
export function shortPeer(peer: string): string {
  return peer.slice(0, 8);
}

function rotateIfNeeded(dir: string): void {
  const path = auditPath(dir);
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size < MAX_BYTES) return;
    renameSync(path, join(dir, 'audit.1.jsonl'));
  } catch {
    /* rotation is best-effort */
  }
}

/** Appends one event. Never throws. */
export function appendAudit(dir: string, event: AuditEvent): void {
  try {
    mkdirSync(dir, { recursive: true });
    rotateIfNeeded(dir);
    const path = auditPath(dir);
    appendFileSync(path, `${JSON.stringify(event)}\n`);
    chmodSync(path, 0o600);
  } catch {
    /* auditing must not break the control path */
  }
}

/** Reads the most recent `limit` events, oldest-first. Never throws. */
export function readAudit(dir: string = piRemoteDir(), limit = 200): AuditEvent[] {
  const parse = (path: string): AuditEvent[] => {
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          try {
            return JSON.parse(line) as AuditEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is AuditEvent => e !== null && typeof e.event === 'string');
    } catch {
      return [];
    }
  };
  const all = [...parse(join(dir, 'audit.1.jsonl')), ...parse(auditPath(dir))];
  return limit > 0 ? all.slice(-limit) : all;
}
