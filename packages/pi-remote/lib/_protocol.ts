/**
 * pi-remote - wire protocol (Phase 2: chat, sync, interactive prompts)
 *
 * Shapes mirror remote_pi's `protocol/types.ts` where the semantics are
 * identical (echo model, session_history, extension_ui_request/response with
 * the pi-ask `ask` envelope), trimmed to what pi-remote implements:
 * no images, no queued messages, no typed session/model actions yet
 * (those are Phase 3+). Casing is snake_case on the wire.
 */

export type PairErrorCode = 'token_expired' | 'token_consumed' | 'token_unknown' | 'internal_error';

// ── pi-ask enrichment (verbatim semantics from remote_pi) ──────────────

export type AskQuestionWireType = 'single' | 'multi' | 'preview';

export interface AskOptionWire {
  value: string;
  label: string;
  description?: string;
  preview?: string;
  freeform?: boolean;
}

export interface AskQuestionWire {
  id: string;
  label: string;
  prompt: string;
  type: AskQuestionWireType;
  required: boolean;
  presentedType?: AskQuestionWireType;
  requestedType?: AskQuestionWireType;
  options: AskOptionWire[];
}

export interface AskEnrichmentWire {
  flow_id: string;
  tool_call_id: string | null;
  source: string;
  title: string | null;
  questions: AskQuestionWire[];
}

/**
 * CASING EXCEPTION: inside the `ask` envelope keys mirror pi-ask's schema
 * verbatim (camelCase) so the bridge forwards responses without remapping.
 */
export interface AskAnswerWire {
  values?: string[];
  customText?: string;
  note?: string;
  optionNotes?: Record<string, string>;
}

export type AskResponseEnrichmentWire =
  | {
      flow_id: string;
      kind: 'answer';
      mode?: 'submit' | 'elaborate';
      answers: Record<string, AskAnswerWire>;
    }
  | { flow_id: string; kind: 'cancel' };

// ── Client → Pi ───────────────────────────────────────────────────────

export type ExtensionUiResponseWire =
  | { type: 'extension_ui_response'; id: string; value: string; ask?: AskResponseEnrichmentWire }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean; ask?: AskResponseEnrichmentWire }
  | { type: 'extension_ui_response'; id: string; cancelled: true; ask?: AskResponseEnrichmentWire }
  | { type: 'extension_ui_response'; id: string; ask: AskResponseEnrichmentWire };

export type ClientMessage =
  | { type: 'pair_request'; id: string; token: string; device_name: string }
  | { type: 'user_message'; id: string; text: string; images?: unknown[]; streaming_behavior?: 'steer' }
  | { type: 'ping'; id: string }
  | { type: 'session_sync'; id: string; limit?: number }
  | { type: 'cancel'; id: string; target_id: string }
  | { type: 'push_subscribe'; id: string; subscription: unknown }
  | { type: 'push_unsubscribe'; id: string }
  | ExtensionUiResponseWire;

// ── Pi → client ───────────────────────────────────────────────────────

export type ExtensionUiRequestWire =
  | {
      type: 'extension_ui_request';
      id: string;
      method: 'select';
      title: string;
      options: string[];
      ask?: AskEnrichmentWire;
    }
  | {
      type: 'extension_ui_request';
      id: string;
      method: 'input';
      title: string;
      placeholder?: string;
      ask?: AskEnrichmentWire;
    }
  | {
      type: 'extension_ui_request';
      id: string;
      method: 'notify';
      message: string;
      notify_type?: 'info' | 'warning' | 'error';
    };

export type ServerMessage =
  | {
      type: 'pair_ok';
      in_reply_to: string;
      session_name: string;
      session_started_at: number;
      room_id: string;
      harness?: { name: string; version: string };
      hostname?: string;
      /** base64url VAPID P-256 point for PushManager.subscribe (Phase 3). */
      vapid_public_key?: string;
    }
  | { type: 'pair_error'; in_reply_to: string; code: PairErrorCode; message: string }
  | { type: 'user_message'; id: string; text: string; streaming_behavior?: 'steer' }
  | { type: 'user_input'; id: string; text: string }
  | { type: 'agent_chunk'; in_reply_to: string; delta: string }
  | { type: 'agent_done'; in_reply_to: string; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'tool_request'; tool_call_id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool_call_id: string; result?: unknown; error?: string }
  | { type: 'error'; in_reply_to?: string; code: string; message: string }
  | { type: 'cancelled'; in_reply_to: string; target_id: string }
  | { type: 'pong'; in_reply_to: string }
  | { type: 'push_ok'; in_reply_to: string }
  | { type: 'bye'; reason: string }
  | {
      type: 'session_history';
      in_reply_to: string;
      session_started_at: number;
      events: HistoryEvent[];
      eos: boolean;
      truncated: boolean;
    }
  | { type: 'compaction'; summary: string; tokens_before: number; ts?: number }
  | ExtensionUiRequestWire;

// ── History (session_sync) ────────────────────────────────────────────

export type HistoryEvent =
  | { ts: number; type: 'user_input'; id: string; text: string }
  | { ts: number; type: 'tool_request'; tool_call_id: string; tool: string; args: Record<string, unknown> }
  | { ts: number; type: 'tool_result'; tool_call_id: string; result?: unknown; error?: string }
  | {
      ts: number;
      type: 'agent_message';
      in_reply_to: string;
      text: string;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | { ts: number; type: 'compaction'; summary: string; tokens_before: number };

// ── Guards ────────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
