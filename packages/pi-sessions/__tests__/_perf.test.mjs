/**
 * pi-sessions - bounded-work tests (PERF-04)
 *
 * Session discovery must stay bounded no matter how many session files
 * accumulate: candidate selection is a top-k by mtime (memory O(MAX_SESSIONS),
 * never O(all files)) and per-file scanning caps at MAX_SESSION_SCAN_LINES so a
 * pathological JSONL cannot be read in full.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshAgentDir, writeSession } from "./_fixtures.mjs";
import { getSessions, getSessionsDir, getSessionsStats } from "../lib/_sessions.ts";
import { MAX_SESSION_SCAN_LINES, MAX_SESSIONS } from "../lib/_constants.ts";

test("session listing: 1200 files selects at most MAX_SESSIONS candidates", async () => {
  freshAgentDir();
  for (let p = 0; p < 40; p++) {
    for (let f = 0; f < 30; f++) {
      writeSession(`proj${p}`, `${f}.jsonl`, [
        { type: "session", cwd: `/p${p}`, timestamp: "2026-07-01T00:00:00Z" },
        { type: "message", message: { role: "user", content: `session ${p}-${f}` } },
      ]);
    }
  }
  const sessions = await getSessions();
  assert.ok(sessions.length <= MAX_SESSIONS, `result must not exceed MAX_SESSIONS (got ${sessions.length})`);
  const stats = getSessionsStats();
  assert.ok(
    stats.candidatesReturned <= MAX_SESSIONS,
    `candidate selection must stay bounded (got ${stats.candidatesReturned})`,
  );
  assert.ok(stats.fileStats >= 1200, "every file was examined once for mtime");
});

test("session listing: a huge session file is scanned with a line cap", async () => {
  freshAgentDir();
  writeSession("projHuge", "big.jsonl", [
    { type: "session", cwd: "/huge", timestamp: "2026-07-01T00:00:00Z" },
  ]);
  // 60k user-message lines (single line per JSONL entry) exceeds the scan cap.
  const file = join(getSessionsDir(), "projHuge", "big.jsonl");
  const line = JSON.stringify({ type: "message", message: { role: "user", content: "m" } });
  const fd = await import("node:fs/promises");
  const handle = await fd.open(file, "a");
  await handle.write(`\n${Array.from({ length: 60_000 }, () => line).join("\n")}\n`);
  await handle.close();

  const sessions = await getSessions();
  const big = sessions.find((s) => s.cwd === "/huge");
  assert.ok(big, "huge session file must appear in the list");
  assert.ok(
    big.messageCount <= MAX_SESSION_SCAN_LINES,
    `scan must cap lines (messageCount=${big.messageCount}, cap=${MAX_SESSION_SCAN_LINES})`,
  );
  const stats = getSessionsStats();
  assert.ok(
    stats.linesScanned <= MAX_SESSION_SCAN_LINES * 2,
    `lines scanned must stay bounded (got ${stats.linesScanned})`,
  );
});