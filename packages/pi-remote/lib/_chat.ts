/**
 * pi-remote - chat session (Phase 2: prompt, streaming, history)
 *
 * Mirrors remote_pi's turn plumbing with a smaller surface:
 * - PWA `user_message` → `pi.sendUserMessage` (always `steer`, like the app
 *   path upstream) + echo back to every active peer (source-of-truth model:
 *   clients render on echo, so all owners share one timeline).
 * - Live `agent_chunk` / `tool_request` / `tool_result` / `agent_done` from
 *   the SDK event bus, replayable via `session_sync` from a normalized
 *   in-memory history (no SDK message-shape dependency at sync time).
 * - `ping` → `pong`; `cancel` → abort via the freshest command ctx.
 * - `extension_ui_response` is forwarded to an injected responder (AskBridge).
 */

import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  isRecord,
  type ClientMessage,
  type ExtensionUiResponseWire,
  type HistoryEvent,
  type ServerMessage,
} from './_protocol.ts';

const SYNC_DEFAULT_LIMIT = 200;
const HISTORY_CAP = 1000;

export interface ChatTransport {
  /** Best-effort single-peer send (never throws). */
  sendTo(peer: string, msg: ServerMessage): void;
  /** Currently active (paired + attached) peer ids. */
  peers(): string[];
}

export interface ChatOptions {
  sessionStartedAt?: number;
  syncLimit?: number;
  /** Replies for flows still awaiting an answer (AskBridge.pendingRequests). */
  askPending?: () => ServerMessage[];
  /** Forwards an extension_ui_response to the ask bridge. */
  uiRespond?: (msg: ExtensionUiResponseWire) => void;
  /** Aborts the running turn; throws on stale/failed abort. */
  abortTurn?: () => void;
  /** Stores a peer's push subscription; throws on invalid shape. */
  pushSubscribe?: (peer: string, subscription: unknown) => void;
  /** Drops a peer's push subscription. */
  pushUnsubscribe?: (peer: string) => void;
  /** Observes every broadcast (extension triggers push wake-ups here). */
  onBroadcasted?: (msg: ServerMessage) => void;
}

export function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (!isRecord(c)) return '';
      return c.type === 'text' ? String(c.text ?? '') : '';
    })
    .join('');
}

export function stringifyToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return stringifyContent(value);
  if (isRecord(value)) {
    // Live `tool_execution_end` wraps content (`{content:[...], details}`):
    // unwrap so live == re-sync; JSON is only the last fallback.
    if (Array.isArray(value.content)) return stringifyContent(value.content);
    if (typeof value.text === 'string') return value.text;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return value === null || value === undefined ? '' : String(value);
}

export class ChatSession {
  private history: HistoryEvent[] = [];
  private lastUserId: string | null = null;
  private currentTurnId: string | null = null;
  private installed = false;
  private readonly sessionStartedAt: number;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly transport: ChatTransport,
    private readonly options: ChatOptions = {}
  ) {
    this.sessionStartedAt = options.sessionStartedAt ?? Date.now();
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  getHistory(): HistoryEvent[] {
    return [...this.history];
  }

  /** Drops the in-flight turn id (extension stop; next turn re-seeds). */
  clearTurn(): void {
    this.currentTurnId = null;
  }

  /** Test hook: seed history without driving SDK events. */
  setHistoryForTest(events: HistoryEvent[]): void {
    this.history = [...events];
  }

  /** Subscribes the SDK event mirror (once per factory lifetime). */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.pi.on('input', (event: unknown) => {
      const e = (event ?? {}) as { text?: unknown; source?: unknown };
      if (e.source === 'extension') return undefined;
      if (!this.hasActive() || typeof e.text !== 'string') return undefined;
      const turnId = `local_${randomUUID()}`;
      this.currentTurnId = turnId;
      this.broadcast({ type: 'user_input', id: turnId, text: e.text });
      return undefined;
    });

    this.pi.on('message_update', (event: unknown) => {
      if (!this.hasActive() || !this.currentTurnId) return;
      const ae = (event as { assistantMessageEvent?: { type?: string; delta?: unknown } } | null)
        ?.assistantMessageEvent;
      if (ae?.type === 'text_delta') {
        this.broadcast({ type: 'agent_chunk', in_reply_to: this.currentTurnId, delta: String(ae.delta ?? '') });
      }
    });

    this.pi.on('tool_execution_start', (event: unknown) => {
      if (!this.hasActive()) return;
      const e = (event ?? {}) as { toolCallId?: unknown; toolName?: unknown; args?: unknown };
      if (typeof e.toolCallId !== 'string' || typeof e.toolName !== 'string') return;
      this.broadcast({
        type: 'tool_request',
        tool_call_id: e.toolCallId,
        tool: e.toolName,
        args: isRecord(e.args) ? e.args : {},
      });
    });

    this.pi.on('tool_execution_end', (event: unknown) => {
      if (!this.hasActive()) return;
      const e = (event ?? {}) as { toolCallId?: unknown; result?: unknown; isError?: unknown };
      if (typeof e.toolCallId !== 'string') return;
      const text = stringifyToolResult(e.result);
      this.broadcast(
        e.isError === true
          ? { type: 'tool_result', tool_call_id: e.toolCallId, error: text }
          : { type: 'tool_result', tool_call_id: e.toolCallId, result: text }
      );
    });

    this.pi.on('message_end', (event: unknown) => {
      const m = (event as { message?: Record<string, unknown> } | null)?.message;
      if (!isRecord(m)) return;
      this.recordMessage(m);
      // A failed turn surfaces as an assistant message with stopReason
      // "error" — without this the phone hangs with no response.
      if (m.role === 'assistant' && m.stopReason === 'error' && this.hasActive()) {
        const message = typeof m.errorMessage === 'string' && m.errorMessage ? m.errorMessage : 'Provider error';
        this.broadcast(
          this.currentTurnId
            ? { type: 'error', in_reply_to: this.currentTurnId, code: 'provider_error', message }
            : { type: 'error', code: 'provider_error', message }
        );
      }
    });

    this.pi.on('agent_end', () => {
      if (this.hasActive() && this.currentTurnId) {
        this.broadcast({ type: 'agent_done', in_reply_to: this.currentTurnId });
      }
      this.currentTurnId = null;
    });

    this.pi.on('session_compact', (event: unknown) => {
      const entry = (event as { compactionEntry?: { summary?: unknown; tokensBefore?: unknown } } | null)
        ?.compactionEntry;
      const summary = typeof entry?.summary === 'string' ? entry.summary : '';
      const tokensBefore = typeof entry?.tokensBefore === 'number' ? entry.tokensBefore : 0;
      const ts = Date.now();
      this.push({ ts, type: 'compaction', summary, tokens_before: tokensBefore });
      if (this.hasActive()) this.broadcast({ type: 'compaction', summary, tokens_before: tokensBefore, ts });
    });
  }

  /** Routes one decoded inner message from an active peer. */
  route(peer: string, msg: ClientMessage): void {
    switch (msg.type) {
      case 'user_message':
        this.handleUserMessage(peer, msg);
        return;
      case 'ping':
        this.transport.sendTo(peer, { type: 'pong', in_reply_to: msg.id });
        return;
      case 'session_sync':
        this.handleSessionSync(peer, msg);
        return;
      case 'cancel':
        this.handleCancel(peer, msg);
        return;
      case 'push_subscribe':
        try {
          if (!this.options.pushSubscribe) throw new Error('push not configured');
          this.options.pushSubscribe(peer, msg.subscription);
        } catch (err) {
          this.transport.sendTo(peer, {
            type: 'error',
            in_reply_to: msg.id,
            code: 'invalid_message',
            message: `Bad push subscription: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        this.transport.sendTo(peer, { type: 'push_ok', in_reply_to: msg.id });
        return;
      case 'push_unsubscribe':
        this.options.pushUnsubscribe?.(peer);
        this.transport.sendTo(peer, { type: 'push_ok', in_reply_to: msg.id });
        return;
      case 'extension_ui_response':
        this.options.uiRespond?.(msg);
        return;
      case 'pair_request':
        // Already paired — idempotent no-op (token is consumed).
        return;
      default:
        this.transport.sendTo(peer, {
          type: 'error',
          in_reply_to: (msg as { id?: unknown }).id as string | undefined,
          code: 'unsupported_type',
          message: `Unsupported message type: ${(msg as { type?: unknown }).type}`,
        });
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────

  private handleUserMessage(peer: string, msg: Extract<ClientMessage, { type: 'user_message' }>): void {
    if (typeof msg.id !== 'string' || !msg.id) {
      this.transport.sendTo(peer, {
        type: 'error',
        code: 'invalid_message',
        message: 'user_message needs a string id',
      });
      return;
    }
    const text = typeof msg.text === 'string' ? msg.text : '';
    if (!text.trim()) {
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'invalid_message',
        message: 'Empty message',
      });
      return;
    }
    if (msg.images !== undefined) {
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'unsupported_type',
        message: 'Image attachments are not supported yet (Phase 3)',
      });
      return;
    }
    const hadTurn = this.currentTurnId !== null;
    if (!hadTurn) this.currentTurnId = msg.id;
    try {
      // Always steer: ignored when idle, required when a turn runs — avoids
      // the race where our mirror hasn't seen turn_start but the SDK is busy.
      this.pi.sendUserMessage(text, { deliverAs: 'steer' });
    } catch (err) {
      if (!hadTurn) this.currentTurnId = null;
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'internal_error',
        message: `Agent rejected incoming message: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    this.broadcast({ type: 'user_message', id: msg.id, text });
  }

  private handleSessionSync(peer: string, msg: Extract<ClientMessage, { type: 'session_sync' }>): void {
    // Mirror semantics: the client SUBSTITUTES its cache — always the last N.
    const cap = this.options.syncLimit ?? SYNC_DEFAULT_LIMIT;
    const requested = typeof msg.limit === 'number' ? msg.limit : cap;
    const limit = Math.min(Math.max(0, Math.floor(requested)), cap);
    const events = limit === 0 ? [] : this.history.slice(-limit);
    this.transport.sendTo(peer, {
      type: 'session_history',
      in_reply_to: msg.id,
      session_started_at: this.sessionStartedAt,
      events,
      eos: true,
      truncated: this.history.length > events.length,
    });
    // Replay still-open ask_user flows to THIS peer only — a sync from owner
    // A must not pop a modal on owner B.
    for (const req of this.options.askPending?.() ?? []) this.transport.sendTo(peer, req);
  }

  private handleCancel(peer: string, msg: Extract<ClientMessage, { type: 'cancel' }>): void {
    if (this.currentTurnId === null) {
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'internal_error',
        message: 'No active turn to cancel',
      });
      return;
    }
    if (!this.options.abortTurn) {
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'internal_error',
        message: 'Cancel unavailable (no command context yet)',
      });
      return;
    }
    try {
      this.options.abortTurn();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (/stale|session replacement or reload/i.test(detail)) {
        this.transport.sendTo(peer, {
          type: 'error',
          in_reply_to: msg.id,
          code: 'internal_error',
          message: 'Session changed under us — retry cancel',
        });
        return;
      }
      this.transport.sendTo(peer, {
        type: 'error',
        in_reply_to: msg.id,
        code: 'internal_error',
        message: `Abort failed: ${detail}`,
      });
      return;
    }
    this.transport.sendTo(peer, { type: 'cancelled', in_reply_to: msg.id, target_id: msg.target_id });
  }

  // ── History ────────────────────────────────────────────────────────

  private recordMessage(m: Record<string, unknown>): void {
    const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.now();
    if (m.role === 'user') {
      const id = `sync_${ts}`;
      this.lastUserId = id;
      this.push({ ts, type: 'user_input', id, text: stringifyContent(m.content) });
    } else if (m.role === 'assistant') {
      const content = Array.isArray(m.content) ? m.content : [];
      const usage = isRecord(m.usage)
        ? { input_tokens: Number(m.usage.input ?? 0), output_tokens: Number(m.usage.output ?? 0) }
        : undefined;
      for (const raw of content) {
        if (!isRecord(raw)) continue;
        if (raw.type === 'text') {
          const text = String(raw.text ?? '');
          if (!text) continue;
          this.push({
            ts,
            type: 'agent_message',
            in_reply_to: this.lastUserId ?? `sync_${ts}`,
            text,
            ...(usage ? { usage } : {}),
          });
        } else if (raw.type === 'toolCall') {
          this.push({
            ts,
            type: 'tool_request',
            tool_call_id: String(raw.id ?? ''),
            tool: String(raw.name ?? ''),
            args: isRecord(raw.arguments) ? raw.arguments : {},
          });
        }
      }
    } else if (m.role === 'toolResult') {
      const text = stringifyToolResult(m.content);
      const toolCallId = String(m.toolCallId ?? '');
      this.push(
        m.isError === true
          ? { ts, type: 'tool_result', tool_call_id: toolCallId, error: text }
          : { ts, type: 'tool_result', tool_call_id: toolCallId, result: text }
      );
    }
  }

  private push(event: HistoryEvent): void {
    this.history.push(event);
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
  }

  // ── Plumbing ───────────────────────────────────────────────────────

  private hasActive(): boolean {
    return this.transport.peers().length > 0;
  }

  private broadcast(msg: ServerMessage): void {
    for (const peer of this.transport.peers()) this.transport.sendTo(peer, msg);
    try {
      this.options.onBroadcasted?.(msg);
    } catch {
      /* observers must never break delivery */
    }
  }
}
