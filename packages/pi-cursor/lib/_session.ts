/**
 * pi-cursor - per-session Cursor agent lifecycle
 *
 * A Cursor agent is stateful: creating one per turn would throw away the
 * conversation the agent keeps on its side, and leaking one per turn would pin
 * a child process for the whole pi session. So we keep one agent per pi session
 * id and rebuild it when the key or the model selection changes.
 *
 * Nothing here is persisted: the agent id lives in memory for the lifetime of
 * the pi session and is never written to disk or to the transcript.
 */

/** Structural subset of the SDK agent we depend on. Keeps tests free of the SDK. */
export interface CursorAgentHandle {
  readonly agentId: string;
  send(message: string, options?: unknown): Promise<CursorRunHandle>;
  close(): void;
  [Symbol.asyncDispose]?(): Promise<void>;
}

export interface CursorRunHandle {
  readonly id: string;
  wait(): Promise<{ status: string; result?: string; error?: { message: string; code?: string }; usage?: unknown }>;
  cancel(): Promise<void>;
  readonly usage?: unknown;
}

export interface CursorSdkLike {
  Agent: {
    create(options: unknown): Promise<CursorAgentHandle>;
    resume(agentId: string, options?: unknown): Promise<CursorAgentHandle>;
  };
}

export interface AgentSessionKey {
  /** pi session id; falls back to a single shared slot when pi omits it. */
  sessionId: string;
  /** Model selection id; a change forces a fresh agent. */
  selectionId: string;
}

interface StoredSession {
  handle: CursorAgentHandle;
  key: AgentSessionKey;
}

const sessions = new Map<string, StoredSession>();

/** Stable slot id for a pi session. */
export function sessionSlotId(sessionId: string | undefined): string {
  const trimmed = sessionId?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : "default";
}

/** True when the stored agent can serve this request without being rebuilt. */
export function isSessionReusable(session: StoredSession | undefined, key: AgentSessionKey): boolean {
  return session !== undefined && session.key.sessionId === key.sessionId && session.key.selectionId === key.selectionId;
}

/** Look up the live agent for a pi session, if any. */
export function getAgentSession(key: AgentSessionKey): CursorAgentHandle | undefined {
  const slot = sessionSlotId(key.sessionId);
  const stored = sessions.get(slot);

  return isSessionReusable(stored, key) ? stored?.handle : undefined;
}

/**
 * Remember the live agent for a pi session, closing the one it replaces.
 *
 * @param key - Session and model selection the agent serves.
 * @param handle - The live Cursor agent.
 */
export function rememberAgentSession(key: AgentSessionKey, handle: CursorAgentHandle): void {
  const slot = sessionSlotId(key.sessionId);
  const existing = sessions.get(slot);

  if (existing && existing.handle !== handle) {
    void disposeAgentHandle(existing.handle);
  }

  sessions.set(slot, { handle, key });
}

/** Close an SDK agent without letting a cleanup failure escape. */
export async function disposeAgentHandle(handle: CursorAgentHandle): Promise<void> {
  try {
    const disposer = handle[Symbol.asyncDispose];

    if (typeof disposer === "function") {
      await disposer.call(handle);
    } else {
      handle.close();
    }
  } catch {
    // Cleanup is best effort: a dead transport must not fail the turn.
  }
}

/** Drop and close the agent bound to one pi session. */
export async function releaseAgentSession(sessionId: string): Promise<void> {
  const slot = sessionSlotId(sessionId);
  const stored = sessions.get(slot);

  sessions.delete(slot);

  if (stored) {
    await disposeAgentHandle(stored.handle);
  }
}

/** Drop and close every agent. Called on `session_shutdown`. */
export async function releaseAllAgentSessions(): Promise<void> {
  const stored = [...sessions.values()];

  sessions.clear();
  await Promise.all(stored.map((entry) => disposeAgentHandle(entry.handle)));
}

/** Test helper: how many agents are currently held. */
export function agentSessionCount(): number {
  return sessions.size;
}
