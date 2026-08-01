import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SessionSidebarComponent, FolderSidebarComponent } from "../lib/_components.ts";
import { makeTheme } from "../../../test/harness.mjs";
import { sampleSession, KEY } from "./_fixtures.mjs";

// ── Component: SessionSidebarComponent ────────────────────────────

function makeSidebar(sessions, done) {
  return new SessionSidebarComponent(makeTheme(), sessions, done, 30);
}

test("session sidebar: escape closes with undefined", () => {
  let result = "unset";
  const sb = makeSidebar([sampleSession()], (r) => (result = r));
  sb.handleInput(KEY.escape);
  assert.equal(result, undefined);
});

test("session sidebar: enter selects the first session", () => {
  const sessions = [sampleSession({ name: "First" }), sampleSession({ name: "Second", file: "/y" })];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.enter);
  assert.equal(result, sessions[0]);
});

test("session sidebar: typing filters and enter selects the match", () => {
  const sessions = [
    sampleSession({ name: "Refactor auth", file: "/a" }),
    sampleSession({ name: "Add tests", file: "/b" }),
  ];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput("a");
  sb.handleInput("u"); // query "au" matches only "Refactor auth"
  sb.handleInput(KEY.enter);
  assert.equal(result?.file, "/a");
});

test("session sidebar: up/down navigation selects other entries", () => {
  const sessions = [sampleSession({ name: "A", file: "/a" }), sampleSession({ name: "B", file: "/b" }), sampleSession({ name: "C", file: "/c" })];
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.down);
  sb.handleInput(KEY.down);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/c");
  sb.handleInput(KEY.up);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/b");
});

test("session sidebar: backspace removes filter chars, ctrl+c closes", () => {
  const sessions = [sampleSession()];
  let result = "unset";
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput("x");
  sb.handleInput(KEY.backspace);
  sb.handleInput(KEY.enter); // filter cleared → first session selected
  assert.equal(result, sessions[0]);
  sb.handleInput(KEY.ctrlC);
  assert.equal(result, undefined);
});

test("session sidebar: home/end and page navigation", () => {
  const sessions = Array.from({ length: 15 }, (_, i) => sampleSession({ name: `S${i}`, file: `/f${i}` }));
  let result;
  const sb = makeSidebar(sessions, (r) => (result = r));
  sb.handleInput(KEY.end);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/f14");
  sb.handleInput(KEY.home);
  sb.handleInput(KEY.enter);
  assert.equal(result.file, "/f0");
  sb.handleInput(KEY.pageDown);
  sb.handleInput(KEY.pageDown);
  sb.handleInput(KEY.enter);
  assert.ok(result.file !== "/f0", "pageDown moves selection");
});

test("session sidebar: render shows folder, message and no-results state", () => {
  const sb = makeSidebar([sampleSession({ cwd: "/home/dev/app", lastUserMessage: "Visible message" })], () => {});
  const lines = sb.render(60).join("\n");
  assert.ok(lines.includes("/home/dev/app"), "folder path rendered");
  assert.ok(lines.includes("Visible message"), "last user message rendered");
  const empty = makeSidebar([], () => {});
  assert.ok(empty.render(60).join("\n").includes("No sessions found"));
});

test("folder sidebar: renders and selects on enter", () => {
  let result;
  const folders = [{ folder: "/home/dev/app", sessions: [sampleSession()], sessionCount: 1, totalMessages: 3, latestDate: "2026-08-01T00:00:00Z", latestModel: "claude" }];
  const fb = new FolderSidebarComponent(makeTheme(), folders, (r) => (result = r), 30);
  const lines = fb.render(60).join("\n");
  assert.ok(lines.includes("/home/dev/app"));
  fb.handleInput(KEY.enter);
  assert.equal(result, folders[0]);
  fb.handleInput(KEY.escape);
  assert.equal(result, undefined);
});

test("session and project modals stay within the supplied terminal bounds", () => {
  const sessions = Array.from({ length: 15 }, (_, index) =>
    sampleSession({ name: `Session ${index}`, file: `/session-${index}` }),
  );
  const folders = sessions.map((session, index) => ({
    folder: `/home/dev/project-${index}`,
    sessions: [session],
    sessionCount: 1,
    totalMessages: session.messageCount,
    latestDate: session.date,
    latestModel: session.model,
  }));

  const components = [
    new SessionSidebarComponent(makeTheme(), sessions, () => {}, 30),
    new FolderSidebarComponent(makeTheme(), folders, () => {}, 30),
  ];

  for (const component of components) {
    const lines = component.render(42);
    assert.ok(lines.length <= 30, `modal rendered ${lines.length} rows in a 30-row terminal`);
    assert.ok(
      lines.every((line) => visibleWidth(line) <= 42),
      "every rendered line must fit the width supplied by the overlay",
    );
  }
});

