import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshAgentDir, writeSession, sampleSession } from "./_fixtures.mjs";
import {
  autoNameSession,
  parseSessionFile,
  formatDate,
  getSessionsDir,
  getSessions,
  clearSessionsCache,
  listSessions,
} from "../lib/_sessions.ts";
import { groupSessionsByFolder } from "../lib/_folders.ts";

// ── Unit: autoNameSession ─────────────────────────────────────────

test("autoNameSession: string content is cleaned and truncated", () => {
  assert.equal(autoNameSession("   hello    world  "), "hello world");
  const long = "a".repeat(100);
  const named = autoNameSession(long);
  assert.equal(named.length, 60);
  assert.ok(named.endsWith("..."));
});

test("autoNameSession: text blocks from content arrays", () => {
  assert.equal(
    autoNameSession([{ type: "text", text: "Refactor login" }, { type: "image", url: "x" }]),
    "Refactor login",
  );
});

test("autoNameSession: empty or non-text content → Empty session", () => {
  assert.equal(autoNameSession(undefined), "Empty session");
  assert.equal(autoNameSession(""), "Empty session");
  assert.equal(autoNameSession([{ type: "toolUse", name: "x" }]), "Empty session");
  assert.equal(autoNameSession(42), "Empty session");
});

// ── Unit: parseSessionFile ────────────────────────────────────────

test("parseSessionFile: extracts name, model, provider, cwd and counts", () => {
  const file = join(getSessionsDir(), "proj", "s.jsonl");
  mkdirSync(join(getSessionsDir(), "proj"), { recursive: true });
  writeFileSync(
    file,
    [
      { type: "session", cwd: "/home/dev/app", timestamp: "2026-07-01T10:00:00Z" },
      { type: "message", message: { role: "user", content: "Fix login bug" } },
      { type: "message", message: { role: "assistant", content: "On it", model: "claude-opus-4", provider: "anthropic" } },
      { type: "message", message: { role: "tool", content: "" } },
    ].map((l) => JSON.stringify(l)).join("\n"),
  );
  const s = parseSessionFile(file);
  assert.equal(s.name, "Fix login bug");
  assert.equal(s.cwd, "/home/dev/app");
  assert.equal(s.model, "claude-opus-4");
  assert.equal(s.provider, "anthropic");
  assert.equal(s.messageCount, 2, "only user+assistant counted");
});

test("parseSessionFile: malformed lines are skipped, missing file → null", () => {
  const file = join(getSessionsDir(), "proj2", "s.jsonl");
  mkdirSync(join(getSessionsDir(), "proj2"), { recursive: true });
  writeFileSync(file, "not json\n{ \"type\": \"message\", \"message\": { \"role\": \"user\", \"content\": \"Hi\" } }\n");
  const s = parseSessionFile(file);
  assert.equal(s.name, "Hi");
  assert.equal(parseSessionFile(join(getSessionsDir(), "missing.jsonl")), null);
});

// ── Unit: formatDate ──────────────────────────────────────────────

test("formatDate: invalid input → empty string", () => {
  assert.equal(formatDate("garbage"), "");
  assert.equal(formatDate(""), "");
});

test("formatDate: normalizes timestamps without timezone to UTC", () => {
  const now = new Date();
  const iso = now.toISOString().slice(0, 19); // no Z
  assert.ok(formatDate(iso).length > 0);
});

test("formatDate: yesterday / older-than-week buckets", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  assert.equal(formatDate(yesterday), "Yesterday");
  const threeDays = new Date(Date.now() - 3 * 86400000).toISOString();
  assert.match(formatDate(threeDays), /^\d+d ago$/);
});

// ── Unit: groupSessionsByFolder ───────────────────────────────────

test("groupSessionsByFolder: groups by cwd and sorts folders newest first", () => {
  const a = sampleSession({ cwd: "/a", date: "2026-07-01T00:00:00Z", mtime: 1, messageCount: 2 });
  const b = sampleSession({ cwd: "/b", date: "2026-08-01T00:00:00Z", mtime: 3, messageCount: 5 });
  const c = sampleSession({ cwd: "/a", date: "2026-07-02T00:00:00Z", mtime: 2, messageCount: 1 });
  const folders = groupSessionsByFolder([a, b, c]);
  assert.equal(folders.length, 2);
  assert.equal(folders[0].folder, "/b", "newest folder first");
  assert.equal(folders[0].sessionCount, 1);
  assert.equal(folders[0].totalMessages, 5);
  assert.equal(folders[1].folder, "/a");
  assert.equal(folders[1].sessionCount, 2);
  assert.equal(folders[1].totalMessages, 3);
});

// ── Unit: session listing (isolated dir) ─────────────────────────

test("getSessions: loads asynchronously and reports progress", async () => {
  freshAgentDir();
  writeSession("projA", "1.jsonl", [
    { type: "session", id: "session-a", cwd: "/a", timestamp: "2026-07-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "first session" } },
    { type: "message", message: { role: "assistant", content: "reply", model: "gpt-5", provider: "openai" } },
    { type: "message", message: { role: "user", content: "latest request" } },
  ]);
  writeSession("projB", "2.jsonl", [
    { type: "session", id: "session-b", cwd: "/b", timestamp: "2026-08-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "second session" } },
  ]);
  clearSessionsCache();

  const progress = [];
  const pending = getSessions((loaded, total) => progress.push([loaded, total]));
  assert.ok(pending instanceof Promise, "session discovery must not block the TUI thread");

  const sessions = await pending;
  assert.equal(sessions.length, 2);
  assert.deepEqual(progress.at(-1), [2, 2]);
  const enriched = sessions.find((session) => session.cwd === "/a");
  assert.equal(enriched.lastUserMessage, "latest request");
  assert.equal(enriched.model, "gpt-5");
  assert.equal(enriched.provider, "openai");
});

test("listSessions: reads nested project dirs, newest first", async () => {
  freshAgentDir(); // isolate from other tests' session files
  writeSession("projA", "1.jsonl", [
    { type: "session", cwd: "/a", timestamp: "2026-07-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "older session" } },
  ]);
  writeSession("projB", "2.jsonl", [
    { type: "session", cwd: "/b", timestamp: "2026-08-01T00:00:00Z" },
    { type: "message", message: { role: "user", content: "newer session" } },
  ]);
  const fs = await import("node:fs");
  const now = new Date();
  fs.utimesSync(join(getSessionsDir(), "projB", "2.jsonl"), now, now);
  fs.utimesSync(join(getSessionsDir(), "projA", "1.jsonl"), new Date(now - 10000), new Date(now - 10000));
  const sessions = listSessions();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].name, "newer session", "newest first");
});

