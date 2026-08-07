/**
 * Shared test harness - mock ExtensionAPI (pi) + ExtensionContext (ctx)
 *
 * Used by e2e tests across all packages. Plain ESM (no TS) so it can be
 * imported by any package test without extra tooling.
 *
 * Usage:
 *   const { pi, emit, runCommand, calls, state } = createMockPi();
 *   const ctx = createMockCtx({ model: makeModel("anthropic", "claude-opus-4-1") });
 *   ext(pi);                 // run extension factory
 *   await emit("session_start", {}, ctx);
 *   await runCommand("reasoning", "auto", ctx);
 */

import assert from "node:assert/strict";

// ── Theme stub (for UI components) ────────────────────────────────

export function makeTheme() {
  return {
    fg: (_name, s) => s,
    bg: (_name, s) => s,
    bold: (s) => s,
    dim: (s) => s,
  };
}

// ── Model stub ────────────────────────────────────────────────────

export function makeModel(provider, id, extra = {}) {
  return {
    provider,
    id,
    name: id,
    reasoning: true,
    contextWindow: 200_000,
    ...extra,
  };
}

// ── Mock ExtensionContext ─────────────────────────────────────────

export function createMockCtx(overrides = {}) {
  const uiCalls = [];
  const providers = []; // addAutocompleteProvider factories

  const ui = {
    addAutocompleteProvider(factory) {
      providers.push(factory);
      uiCalls.push(["addAutocompleteProvider", factory]);
    },
    notify(msg, type) {
      uiCalls.push(["notify", msg, type]);
    },
    setStatus(key, text) {
      uiCalls.push(["setStatus", key, text]);
    },
    setWidget(name, factory, opts) {
      uiCalls.push(["setWidget", name, factory, opts]);
    },
    setFooter(factory) {
      uiCalls.push(["setFooter", factory]);
    },
    /** Records the component factory so tests can drive it: ui.customCalls[0].factory(fakeTui, theme, keybindings, done) */
    custom(factory, opts) {
      uiCalls.push(["custom", factory, opts]);
      return Promise.resolve(undefined);
    },
    select(prompt, options) {
      uiCalls.push(["select", prompt, options]);
      return Promise.resolve(undefined);
    },
    input(prompt, opts) {
      uiCalls.push(["input", prompt, opts]);
      return Promise.resolve(undefined);
    },
    confirm(prompt, opts) {
      uiCalls.push(["confirm", prompt, opts]);
      return Promise.resolve(undefined);
    },
    // test helpers
    _uiCalls: uiCalls,
    _providers: providers,
  };

  const sessionManager = {
    getEntries() {
      return [];
    },
    getBranch() {
      return [];
    },
  };

  const ctx = {
    cwd: "/tmp",
    hasUI: true,
    mode: "tui",
    model: undefined,
    thinkingLevel: "high",
    signal: new AbortController().signal,
    ui,
    sessionManager,
    getContextUsage() {
      return undefined;
    },
    modelRegistry: {
      getModel: () => undefined,
    },
    async switchSession(sessionPath, opts) {
      return { cancelled: false, sessionPath, opts };
    },
    reload() {},
    getSystemPromptOptions() {
      return {};
    },
    async waitForIdle() {},
    async newSession() {
      return { cancelled: false };
    },
    async fork() {
      return { cancelled: false };
    },
    async navigateTree() {
      return { cancelled: false };
    },
    ...overrides,
    ui: overrides.ui ?? ui,
    sessionManager: overrides.sessionManager ?? sessionManager,
  };
  return ctx;
}

// ── Mock ExtensionAPI (pi) ────────────────────────────────────────

export function createMockPi(overrides = {}) {
  const handlers = new Map(); // event -> handler[]
  const commands = new Map(); // name -> def
  const tools = new Map(); // name -> def
  const flags = new Map(); // name -> def
  const calls = {
    on: [],
    registerCommand: [],
    registerTool: [],
    setThinkingLevel: [],
    setSessionName: [],
    setActiveTools: [],
    getFlag: [],
    registerFlag: [],
    getAllTools: [],
    sendUserMessage: [],
    sendMessage: [],
    exec: [],
  };
  const state = {
    thinkingLevel: "high",
    sessionName: "",
    activeTools: [],
  };

  const pi = {
    // ── Events ──
    on(event, handler) {
      calls.on.push([event, handler]);
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },

    // ── Commands ──
    registerCommand(name, def) {
      calls.registerCommand.push([name, def]);
      commands.set(name, def);
    },

    // ── Tools ──
    registerTool(tool) {
      calls.registerTool.push(tool);
      if (tool?.name) tools.set(tool.name, tool);
    },
    getTool(name) {
      return tools.get(name);
    },
    getAllTools() {
      calls.getAllTools.push([]);
      return [...tools.values()];
    },

    // ── Thinking level ──
    setThinkingLevel(level) {
      calls.setThinkingLevel.push(level);
      state.thinkingLevel = level;
    },
    getThinkingLevel() {
      return state.thinkingLevel;
    },

    // ── Session name ──
    setSessionName(name) {
      calls.setSessionName.push(name);
      state.sessionName = name;
    },
    getSessionName() {
      return state.sessionName;
    },

    // ── Active tools ──
    setActiveTools(list) {
      calls.setActiveTools.push(list);
      state.activeTools = [...list];
    },
    getActiveTools() {
      return state.activeTools;
    },

    // ── Session entries ──
    appendEntry(type, data) {
      calls.appendEntry ??= [];
      calls.appendEntry.push([type, data]);
    },

    // ── Flags ──
    registerFlag(name, opts) {
      calls.registerFlag.push([name, opts]);
      flags.set(name, opts ?? {});
    },
    getFlag(name) {
      calls.getFlag.push(name);
      return flags.get(name);
    },

    // ── Messaging / exec ──
    sendUserMessage(content, opts) {
      calls.sendUserMessage.push([content, opts]);
      return Promise.resolve();
    },
    sendMessage(message, opts) {
      calls.sendMessage.push([message, opts]);
      return Promise.resolve();
    },
    exec(command, opts) {
      calls.exec.push([command, opts]);
      return Promise.resolve();
    },

    // ── Event bus ──
    events: {
      _subs: new Set(),
      subscribe(fn) {
        this._subs.add(fn);
        return () => this._subs.delete(fn);
      },
      emit(type, payload) {
        for (const fn of this._subs) {
          try {
            fn({ type, ...payload });
          } catch {
            /* ignore */
          }
        }
      },
    },
  };

  const emit = async (event, payload = {}, ctx = createMockCtx()) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler(payload, ctx);
    }
  };

  const runCommand = async (name, args = "", ctx = createMockCtx()) => {
    const def = commands.get(name);
    assert.ok(def, `command "${name}" is not registered`);
    return def.handler(args, ctx);
  };

  Object.assign(pi, overrides);
  return { pi, emit, runCommand, handlers, commands, tools, flags, calls, state };
}
