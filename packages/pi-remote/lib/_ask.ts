/**
 * pi-remote - ask_user bridge (Phase 2)
 *
 * Ports remote_pi's `extension_ui_bridge.ts` contract to pi-remote: when
 * pi-ask (sibling package `@pixu1980/pi-ask`, or any emitter of the same
 * event contract) opens a clarification flow, the paired phone renders it
 * natively instead of stranding the mobile user while the desktop TUI
 * blocks on its dialog.
 *
 * Event contract (all payloads carry `version: 1`):
 * - `@eko24ive/pi-ask:started`  { flowId, toolCallId?, source, title?, questions[] }
 * - `@eko24ive/pi-ask:submit`   { requestId, flowId, response }  (we emit this)
 * - `@eko24ive/pi-ask:submit-result` { requestId, flowId, ok, error? } (pi-ask emits)
 * - `@eko24ive/pi-ask:completed` { flowId, result }
 *
 * Inert when pi-ask is absent: no events fire, nothing breaks.
 */

import {
  asString,
  isRecord,
  type AskAnswerWire,
  type AskEnrichmentWire,
  type AskOptionWire,
  type AskQuestionWire,
  type AskQuestionWireType,
  type ExtensionUiResponseWire,
  type ServerMessage,
} from './_protocol.ts';

export const PI_ASK_STARTED = '@eko24ive/pi-ask:started';
export const PI_ASK_COMPLETED = '@eko24ive/pi-ask:completed';
export const PI_ASK_SUBMIT = '@eko24ive/pi-ask:submit';
export const PI_ASK_SUBMIT_RESULT = '@eko24ive/pi-ask:submit-result';

/** Flows forgotten if pi-ask never resolves them (e.g. session_shutdown). */
const FLOW_TTL_MS = 10 * 60 * 1000;

interface EventBus {
  on(channel: string, handler: (data: unknown) => void): () => void;
  emit(channel: string, data: unknown): void;
}

interface ActiveFlow {
  flowId: string;
  toolCallId: string | null;
  source: string;
  title: string | null;
  questions: AskQuestionWire[];
}

export interface AskBridge {
  /** Route an inbound `extension_ui_response` back to pi-ask. */
  respond(msg: ExtensionUiResponseWire): void;
  /** Open flows, for `session_sync` to replay to late joiners. */
  pendingRequests(): ServerMessage[];
  dispose(): void;
}

export function createAskBridge(
  events: EventBus | null | undefined,
  broadcast: (msg: ServerMessage) => void
): AskBridge | null {
  if (!events || typeof events.on !== 'function' || typeof events.emit !== 'function') return null;
  // Fresh const so narrowing survives inside nested closures.
  const bus: EventBus = events;
  const activeFlows = new Map<string, ActiveFlow>();
  const flowTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearFlowTtl(flowId: string): void {
    const t = flowTimers.get(flowId);
    if (t !== undefined) {
      clearTimeout(t);
      flowTimers.delete(flowId);
    }
  }

  function armFlowTtl(flowId: string): void {
    clearFlowTtl(flowId);
    const timer = setTimeout(() => {
      if (!activeFlows.delete(flowId)) return;
      flowTimers.delete(flowId);
      broadcast({
        type: 'extension_ui_request',
        id: flowId,
        method: 'notify',
        message: 'Clarification expired on the bridge — retry or answer on desktop.',
        notify_type: 'warning',
      });
    }, FLOW_TTL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    flowTimers.set(flowId, timer);
  }

  function emitSubmit(
    requestId: string,
    flowId: string,
    response:
      { kind: 'answer'; mode?: 'submit' | 'elaborate'; answers: Record<string, AskAnswerWire> } | { kind: 'cancel' }
  ): void {
    try {
      bus.emit(PI_ASK_SUBMIT, { version: 1, requestId, flowId, response });
    } catch {
      /* pi-ask gone — the flow resolves locally or times out on its own */
    }
  }

  function respond(msg: ExtensionUiResponseWire): void {
    const ask = msg.ask;
    if (('cancelled' in msg && msg.cancelled === true) || (ask !== undefined && ask.kind === 'cancel')) {
      const flowId = ask?.flow_id ?? (activeFlows.has(msg.id) ? msg.id : null);
      if (!flowId) return;
      emitSubmit(msg.id, flowId, { kind: 'cancel' });
      return;
    }
    if (ask !== undefined && ask.kind === 'answer') {
      emitSubmit(msg.id, ask.flow_id, {
        kind: 'answer',
        ...(ask.mode !== undefined ? { mode: ask.mode } : {}),
        answers: ask.answers,
      });
      return;
    }
    // Degraded path: label-only answer maps back to the first question's
    // option value (first match wins on duplicate labels); free text
    // becomes a custom answer.
    const flow = activeFlows.get(msg.id);
    if (!flow || flow.questions.length === 0) return;
    const question = flow.questions[0];
    if (!question) return;
    const label = 'value' in msg ? String(msg.value) : '';
    const match = question.options.find((o) => o.label === label);
    emitSubmit(msg.id, flow.flowId, {
      kind: 'answer',
      mode: 'submit',
      answers: { [question.id]: match ? { values: [match.value] } : label ? { customText: label } : {} },
    });
  }

  const unsubStarted = bus.on(PI_ASK_STARTED, (raw: unknown) => {
    const event = parseStartedEvent(raw);
    if (!event) return;
    activeFlows.set(event.flowId, {
      flowId: event.flowId,
      toolCallId: event.toolCallId ?? null,
      source: event.source ?? 'tool',
      title: event.title ?? null,
      questions: event.questions,
    });
    armFlowTtl(event.flowId);
    const flow = activeFlows.get(event.flowId);
    if (flow) broadcast(requestForFlow(flow));
  });

  const unsubCompleted = bus.on(PI_ASK_COMPLETED, (raw: unknown) => {
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.flowId !== 'string') return;
    clearFlowTtl(raw.flowId);
    activeFlows.delete(raw.flowId);
    // Same id as the originating request: the client dismisses its modal.
    broadcast({
      type: 'extension_ui_request',
      id: raw.flowId,
      method: 'notify',
      message: 'Clarification resolved.',
    });
  });

  const unsubResult = bus.on(PI_ASK_SUBMIT_RESULT, (raw: unknown) => {
    if (!isRecord(raw) || raw.version !== 1 || raw.ok === true) return;
    const message =
      typeof raw.message === 'string'
        ? raw.message
        : typeof raw.error === 'string'
          ? raw.error
          : 'Clarification answer was not accepted.';
    const flowId =
      typeof raw.flowId === 'string' ? raw.flowId : activeFlows.size === 1 ? [...activeFlows.keys()][0] : undefined;
    if (!flowId) return;
    broadcast({ type: 'extension_ui_request', id: flowId, method: 'notify', message, notify_type: 'warning' });
  });

  return {
    respond,
    pendingRequests: () => [...activeFlows.values()].map(requestForFlow),
    dispose() {
      unsubStarted();
      unsubCompleted();
      unsubResult();
      for (const t of flowTimers.values()) clearTimeout(t);
      flowTimers.clear();
      activeFlows.clear();
    },
  };
}

/** One request per flow (flowId = correlation id); empty options degrade to input. */
function requestForFlow(flow: ActiveFlow): ServerMessage {
  const first = flow.questions[0];
  const title = flow.title ?? first?.prompt ?? 'Clarification';
  const options = first ? first.options.map((o) => o.label) : [];
  const ask: AskEnrichmentWire = {
    flow_id: flow.flowId,
    tool_call_id: flow.toolCallId,
    source: flow.source,
    title: flow.title,
    questions: flow.questions,
  };
  if (options.length === 0) {
    return { type: 'extension_ui_request', id: flow.flowId, method: 'input', title, placeholder: first?.prompt, ask };
  }
  return { type: 'extension_ui_request', id: flow.flowId, method: 'select', title, options, ask };
}

// ── Defensive parsing (shapes come from a third-party package) ────────

function asQuestionType(value: unknown): AskQuestionWireType | undefined {
  return value === 'single' || value === 'multi' || value === 'preview' ? value : undefined;
}

function parseOption(value: unknown): AskOptionWire | null {
  if (!isRecord(value)) return null;
  const val = typeof value.value === 'string' ? value.value : asString(value.label);
  const label = typeof value.label === 'string' ? value.label : val;
  if (!val || !label) return null;
  return {
    value: val,
    label,
    description: asString(value.description),
    preview: asString(value.preview),
    freeform: value.freeform === true ? true : undefined,
  };
}

function parseQuestion(value: unknown): AskQuestionWire | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.prompt !== 'string') return null;
  if (!Array.isArray(value.options)) return null;
  const options: AskOptionWire[] = [];
  for (const o of value.options) {
    const opt = parseOption(o);
    if (!opt) return null;
    options.push(opt);
  }
  return {
    id: value.id,
    label: typeof value.label === 'string' ? value.label : value.prompt,
    prompt: value.prompt,
    type: asQuestionType(value.type) ?? 'single',
    required: value.required === true,
    presentedType: asQuestionType(value.presentedType),
    requestedType: asQuestionType(value.requestedType),
    options,
  };
}

function parseStartedEvent(raw: unknown): {
  flowId: string;
  toolCallId?: string;
  source?: string;
  title?: string;
  questions: AskQuestionWire[];
} | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  if (typeof raw.flowId !== 'string') return null;
  if (!Array.isArray(raw.questions)) return null;
  const questions: AskQuestionWire[] = [];
  for (const q of raw.questions) {
    const parsed = parseQuestion(q);
    if (!parsed) return null;
    questions.push(parsed);
  }
  if (questions.length === 0) return null;
  return {
    flowId: raw.flowId,
    toolCallId: asString(raw.toolCallId),
    source: asString(raw.source),
    title: asString(raw.title),
    questions,
  };
}
