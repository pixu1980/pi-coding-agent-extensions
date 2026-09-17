/**
 * pi-remote PWA - Phase 2 (vanilla JS module, zero dependencies).
 *
 * Pairing → relay chat → history sync → ask_user modals → notifications.
 * No App Store: install via "Add to Home Screen" for background wake-ups.
 */

import { RelayClient, ed25519Supported, loadOrCreateIdentity } from './relay.js';

'use strict';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const pairSection = $('pair-section');
const chatSection = $('chat-section');
const tokenEl = $('token');
const deviceEl = $('device');
const relayEl = $('relay');
const logEl = $('log');
const composerEl = $('composer');
const sendBtn = $('send');
const askModal = $('ask-modal');
const askTitle = $('ask-title');
const askBody = $('ask-body');
const askActions = $('ask-actions');
const toastEl = $('toast');

const DEFAULT_RELAY = 'wss://relay-rp1.jacobmoura.work';
const BACKOFFS = [1000, 2000, 5000, 10000, 30000];

const state = {
  relay: null,
  identity: null,
  session: null, // {piPeer, room, pairedAt, name}
  relayUrl: DEFAULT_RELAY,
  pending: new Map(), // user_message id -> li element
  agentBubbles: new Map(), // turn id -> {textEl, usageEl}
  openAsk: new Map(), // request id -> request
  backoff: 0,
  syncDone: false,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

async function notify(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker?.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, tag, icon: './icon.svg' });
    } else {
      const n = new Notification(title, { body, tag, icon: './icon.svg' });
      setTimeout(() => n.close(), 6000);
    }
  } catch {
    /* notifications are best-effort */
  }
}

// ── Chat rendering ─────────────────────────────────────────────────

function bubble(kind, text) {
  const li = document.createElement('li');
  li.className = `msg ${kind}`;
  const pre = document.createElement('div');
  pre.className = 'text';
  pre.textContent = text;
  li.append(pre);
  logEl.append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

function toolRow(label, detail, isError) {
  const li = document.createElement('li');
  li.className = `msg tool${isError ? ' error' : ''}`;
  const summary = document.createElement('div');
  summary.className = 'text';
  summary.textContent = label;
  li.append(summary);
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail.slice(0, 2000);
    li.append(pre);
  }
  logEl.append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

function renderHistory(events) {
  logEl.replaceChildren();
  state.pending.clear();
  state.agentBubbles.clear();
  for (const ev of events) {
    if (ev.type === 'user_input') bubble('user', ev.text);
    else if (ev.type === 'agent_message') bubble('agent', ev.text);
    else if (ev.type === 'tool_request') toolRow(`⚙ ${ev.tool}`, JSON.stringify(ev.args));
    else if (ev.type === 'tool_result') toolRow('↳ done', ev.error ?? String(ev.result ?? ''), !!ev.error);
    else if (ev.type === 'compaction') toolRow('🗜 context compacted', ev.summary);
  }
}

// ── Inbound routing ────────────────────────────────────────────────

function onOuter({ peer, inner }) {
  switch (inner.type) {
    case 'pair_ok':
      onPairOk(inner, peer);
      return;
    case 'pair_error':
      setStatus(`Pairing failed: ${inner.message}`);
      toast(`Pairing failed: ${inner.message}`);
      return;
    case 'user_message': {
      // Echo = source of truth (covers our own sends + other owners).
      const pending = state.pending.get(inner.id);
      if (pending) {
        pending.classList.remove('pending');
        state.pending.delete(inner.id);
      } else {
        bubble('user', inner.text);
      }
      return;
    }
    case 'user_input':
      bubble('user', inner.text);
      return;
    case 'agent_chunk': {
      let b = state.agentBubbles.get(inner.in_reply_to);
      if (!b) {
        const li = bubble('agent', '');
        b = { el: li, textEl: li.firstChild };
        state.agentBubbles.set(inner.in_reply_to, b);
      }
      b.textEl.textContent += inner.delta;
      b.el.scrollIntoView({ block: 'nearest' });
      return;
    }
    case 'agent_done':
      state.agentBubbles.delete(inner.in_reply_to);
      setStatus('Idle.');
      notify('pi-remote', 'Agent finished its turn.', `done-${inner.in_reply_to}`);
      return;
    case 'tool_request':
      toolRow(`⚙ ${inner.tool}`, JSON.stringify(inner.args));
      return;
    case 'tool_result':
      toolRow('↳ done', inner.error ?? String(inner.result ?? ''), !!inner.error);
      return;
    case 'session_history':
      renderHistory(inner.events || []);
      setStatus(inner.truncated ? 'Synced (older turns truncated).' : 'Synced.');
      state.syncDone = true;
      return;
    case 'compaction':
      toolRow('🗜 context compacted', inner.summary);
      return;
    case 'extension_ui_request':
      onAskRequest(inner);
      return;
    case 'error':
      toast(inner.message);
      bubble('sys', `Error: ${inner.message}`);
      notify('pi-remote', inner.message, 'err');
      return;
    case 'pong':
      return;
    case 'bye':
      // The Pi revoked this device (or replaced the session): drop the local
      // pairing so a stale token can never silently reconnect.
      onBye(inner.reason);
      return;
    default:
      break;
  }
}

function onBye(reason) {
  state.session = null;
  localStorage.removeItem('pi-remote.session');
  state.pending.clear();
  state.agentBubbles.clear();
  state.openAsk.clear();
  closeAsk();
  try {
    state.relay?.close();
  } catch {
    /* already closed */
  }
  state.relay = null;
  chatSection.hidden = true;
  pairSection.hidden = false;
  const why = reason === 'revoked' ? 'This device was revoked on the Pi.' : `Session closed by the Pi (${reason}).`;
  setStatus(`${why} Run /pi-remote pair again to re-link.`);
  toast(why);
}

// ── Ask modal ──────────────────────────────────────────────────────

function closeAsk() {
  askModal.hidden = true;
  askBody.replaceChildren();
  askActions.replaceChildren();
}

function onAskRequest(req) {
  if (req.method === 'notify') {
    if (req.notify_type === 'warning' || req.notify_type === 'error') {
      toast(req.message);
      notify('pi-remote', req.message, req.id);
    } else if (/resolv|expir/i.test(req.message)) {
      // Dismiss signal for a previously opened modal.
      if (state.openAsk.has(req.id)) {
        state.openAsk.delete(req.id);
        if (state.openAsk.size === 0) closeAsk();
      }
    }
    return;
  }

  state.openAsk.set(req.id, req);
  askTitle.textContent = req.title || 'Clarification';
  askBody.replaceChildren();
  askActions.replaceChildren();

  const questions = req.ask?.questions ?? [];
  const inputs = new Map(); // questionId -> {kind, els}

  if (questions.length > 0) {
    for (const q of questions) {
      const wrap = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = q.prompt;
      wrap.append(legend);
      if (q.type === 'multi') {
        const boxes = [];
        for (const o of q.options) {
          const label = document.createElement('label');
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.value = o.value;
          label.append(box, ` ${o.label}`);
          if (o.description) label.title = o.description;
          wrap.append(label);
          boxes.push(box);
        }
        const note = noteInput(wrap, q);
        inputs.set(q.id, { kind: 'multi', boxes, note });
      } else {
        const radios = [];
        for (const o of q.options) {
          const label = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = q.id;
          radio.value = o.value;
          label.append(radio, ` ${o.label}`);
          if (o.description) label.title = o.description;
          wrap.append(label);
          radios.push(radio);
        }
        const note = noteInput(wrap, q);
        inputs.set(q.id, { kind: 'single', radios, note });
      }
      askBody.append(wrap);
    }
  } else if (req.method === 'input') {
    const input = document.createElement('input');
    input.placeholder = req.placeholder || 'Type your answer';
    input.id = 'ask-free';
    askBody.append(input);
    inputs.set('__free', { kind: 'free', el: input });
  }

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = 'Send answer';
  submit.onclick = () => {
    const answers = {};
    for (const [qid, ctl] of inputs) {
      if (ctl.kind === 'multi') {
        answers[qid] = {
          values: ctl.boxes.filter((b) => b.checked).map((b) => b.value),
          ...(ctl.note?.value ? { note: ctl.note.value } : {}),
        };
      } else if (ctl.kind === 'single') {
        const checked = ctl.radios.find((r) => r.checked);
        answers[qid] = {
          ...(checked ? { values: [checked.value] } : {}),
          ...(ctl.note?.value ? { note: ctl.note.value } : {}),
        };
      } else {
        answers[qid] = { customText: ctl.el.value };
      }
    }
    respondAsk(req.id, { flow_id: req.ask?.flow_id ?? req.id, kind: 'answer', answers });
  };
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => respondAsk(req.id, { flow_id: req.ask?.flow_id ?? req.id, kind: 'cancel' });
  askActions.append(submit, cancel);
  askModal.hidden = false;
  notify('pi-remote', `Input needed: ${req.title || 'clarification'}`, req.id);
}

function noteInput(wrap, q) {
  const note = document.createElement('input');
  note.placeholder = 'Add a note (optional)';
  note.setAttribute('aria-label', `Note for ${q.prompt}`);
  wrap.append(note);
  return note;
}

function respondAsk(id, ask) {
  sendInner({ type: 'extension_ui_response', id, ask });
  state.openAsk.delete(id);
  if (state.openAsk.size === 0) closeAsk();
  else {
    const [nextId, next] = state.openAsk.entries().next().value;
    void nextId;
    onAskRequest(next);
  }
}

// ── Outbound ───────────────────────────────────────────────────────

function sendInner(inner) {
  if (!state.relay || !state.session) throw new Error('not paired');
  state.relay.sendEnvelope(state.session.piPeer, state.session.room, inner);
}

function sendPrompt() {
  const text = composerEl.value.trim();
  if (!text) return;
  const id = crypto.randomUUID();
  const li = bubble('user', text);
  li.classList.add('pending');
  state.pending.set(id, li);
  composerEl.value = '';
  setStatus('Working…');
  try {
    sendInner({ type: 'user_message', id, text });
  } catch (err) {
    li.classList.remove('pending');
    state.pending.delete(id);
    toast(`Send failed: ${err.message}`);
    setStatus('Send failed — reconnecting…');
  }
}

// ── Connection lifecycle ───────────────────────────────────────────

async function ensureRelay(roomId) {
  if (state.relay) return state.relay;
  if (!ed25519Supported()) {
    throw new Error('Needs HTTPS + a browser with WebCrypto Ed25519 (current Chrome/Safari/Firefox).');
  }
  state.identity = state.identity || (await loadOrCreateIdentity());
  const relay = new RelayClient(state.relayUrl, state.identity, { roomId });
  relay.onOuter = onOuter;
  relay.onClose = () => {
    if (relay.wantClose) return;
    setStatus('Connection lost — retrying…');
    scheduleReconnect();
  };
  await relay.connect();
  state.relay = relay;
  state.backoff = 0;
  return relay;
}

function scheduleReconnect() {
  if (!state.session) return; // nothing to rejoin until paired
  const delay = BACKOFFS[Math.min(state.backoff, BACKOFFS.length - 1)];
  state.backoff += 1;
  setStatus(`Reconnecting in ${Math.round(delay / 1000)}s…`);
  setTimeout(async () => {
    try {
      state.relay = null;
      await ensureRelay(state.session.room);
      sendInner({ type: 'session_sync', id: crypto.randomUUID() });
      setStatus('Reconnected.');
    } catch {
      scheduleReconnect();
    }
  }, delay);
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem('pi-remote.session', JSON.stringify(session));
}

function urlBase64ToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const s = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Subscribes to remote wake-ups and hands the subscription to the Pi over
 * the relay (the Pi encrypts per RFC 8291; payloads stay content-free).
 * No-op without permission, a service worker, or a VAPID key from pair_ok.
 */
async function subscribePush() {
  if (!state.session?.vapidKey) return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    log('Push unavailable here: wake-ups only while the page is open.');
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(state.session.vapidKey),
      });
    }
    sendInner({ type: 'push_subscribe', id: crypto.randomUUID(), subscription: sub.toJSON() });
    localStorage.removeItem('pi-remote.push-dirty');
    return true;
  } catch (err) {
    log(`Push subscribe failed: ${err.message}`);
    return false;
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem('pi-remote.session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function pair(token, deviceName) {
  const params = new URLSearchParams(location.search);
  const room = params.get('rm') || 'main';
  const piPeer = params.get('epk');
  if (!piPeer) throw new Error('Pairing link misses the Pi id (epk). Re-run /pi-remote pair.');
  setStatus('Connecting to relay…');
  const relay = await ensureRelay(room);
  const id = crypto.randomUUID();
  relay.sendEnvelope(piPeer, room, { type: 'pair_request', id, token, device_name: deviceName || 'My Phone' });
  // pair_ok arrives via onOuter → onPairOk. Guard with a timeout.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing timed out — token may have expired.')), 20000);
    const check = setInterval(() => {
      if (state.session) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 200);
  });
}

function onPairOk(inner, senderPeer) {
  // Trust the relay-routed sender id over the URL param (same value normally).
  const piPeer = senderPeer || currentPiPeer();
  saveSession({
    piPeer,
    room: currentRoom(),
    pairedAt: Date.now(),
    name: inner.session_name,
    vapidKey: inner.vapid_public_key || null,
  });
  enterChat();
  sendInner({ type: 'session_sync', id: crypto.randomUUID() });
  setStatus('Paired — syncing…');
  // Best-effort remote wake-ups (needs notification permission first).
  subscribePush().then((ok) => {
    if (ok) log('Remote wake-ups on: this phone nudges you when the agent finishes.');
  });
}

function currentPiPeer() {
  return new URLSearchParams(location.search).get('epk') || state.session?.piPeer;
}

function currentRoom() {
  return new URLSearchParams(location.search).get('rm') || state.session?.room || 'main';
}

function enterChat() {
  pairSection.hidden = true;
  chatSection.hidden = false;
  setStatus(state.syncDone ? 'Synced.' : 'Syncing…');
}

async function resume() {
  const saved = loadSession();
  if (!saved?.piPeer || !saved?.room) return false;
  try {
    setStatus('Reconnecting…');
    await ensureRelay(saved.room);
    state.session = saved;
    // Re-attach as a known peer: sync replays history + open asks.
    sendInner({ type: 'session_sync', id: crypto.randomUUID() });
    enterChat();
    return true;
  } catch {
    return false;
  }
}

// ── Boot ───────────────────────────────────────────────────────────

function init() {
  const params = new URLSearchParams(location.search);
  const urlToken = params.get('t');
  const name = params.get('n');
  relayEl.value = localStorage.getItem('pi-remote.relay') || DEFAULT_RELAY;
  state.relayUrl = relayEl.value;
  relayEl.addEventListener('change', () => {
    state.relayUrl = relayEl.value.trim() || DEFAULT_RELAY;
    localStorage.setItem('pi-remote.relay', state.relayUrl);
  });

  if (urlToken) tokenEl.value = urlToken;
  if (name) {
    document.title = `pi-remote — ${name}`;
    $('pair-blurb').textContent = `Pairing with “${name}”. No app install needed.`;
  }

  $('pair').addEventListener('click', async () => {
    try {
      await pair(tokenEl.value.trim(), deviceEl.value.trim());
    } catch (err) {
      setStatus(err.message);
      toast(err.message);
    }
  });
  $('notify').addEventListener('click', async () => {
    if (!('Notification' in window)) {
      setStatus('This browser has no Notification API.');
      return;
    }
    const p = await Notification.requestPermission();
    if (p !== 'granted') {
      setStatus(`Notifications ${p}.`);
      return;
    }
    setStatus('Notifications enabled.');
    if (state.session && !chatSection.hidden) {
      const ok = await subscribePush();
      setStatus(ok ? 'Notifications + remote wake-ups enabled.' : 'Notifications enabled (local only).');
    }
  });
  sendBtn.addEventListener('click', sendPrompt);
  composerEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      sendPrompt();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Fast path: already paired on this phone → straight to chat.
  resume().then((ok) => {
    if (!ok) {
      setStatus(params.get('rm') ? `Ready to pair room ${params.get('rm')}.` : 'Ready. Run /pi-remote pair on your machine.');
      return;
    }
    // Re-send the subscription if the worker rotated it while we were away.
    if (localStorage.getItem('pi-remote.push-dirty')) void subscribePush();
  });

  // The service worker asks for a sync when a notification is tapped.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'pi-remote-sync' && state.session) {
        try {
          sendInner({ type: 'session_sync', id: crypto.randomUUID() });
        } catch {
          /* reconnect flow will sync instead */
        }
      } else if (ev.data?.type === 'pi-remote-push-dirty') {
        localStorage.setItem('pi-remote.push-dirty', '1');
        if (state.session && !chatSection.hidden) void subscribePush();
      }
    });
  }
  setStatus('Starting…');
}

init();
