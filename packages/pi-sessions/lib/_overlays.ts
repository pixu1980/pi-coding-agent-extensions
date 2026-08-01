/**
 * pi-sessions — overlay flows (private module)
 *
 * /sessions and /projects overlay logic plus session restore.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { SIDEBAR_WIDTH } from "./_constants.ts";
import type { SessionSummary, FolderSummary } from "./_types.ts";
import { getSessions } from "./_sessions.ts";
import { groupSessionsByFolder } from "./_folders.ts";
import { SessionSidebarComponent, FolderSidebarComponent } from "./_components.ts";

/**
 * Show the session history overlay (popup mode).
 */
export async function showSessionSidebar(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Session overlay requires TUI mode.", "error");
    return;
  }

  // Show loading state
  ctx.ui.notify("Loading sessions...", "info");

  try {
    const sessions = getSessions();
    if (sessions.length === 0) {
      ctx.ui.notify("No sessions found.", "info");
      return;
    }

    const overlayOptions = {
      anchor: "right-center" as const,
      width: SIDEBAR_WIDTH + 2,
      minWidth: 40,
      height: "55%",
      margin: 1,
    };

    const result = await ctx.ui.custom<SessionSummary | undefined>(
      (tui, theme, _keybindings, done) =>
        new SessionSidebarComponent(theme, sessions, done, tui.terminal.rows),
      {
        overlay: true,
        overlayOptions,
      },
    );

    if (result) {
      // User selected a session - restore it
      ctx.ui.notify(`Loading session: ${result.name}`, "info");
      await loadSession(ctx, result.file);
    }
  } catch (error) {
    console.error("[pi-sessions] Error in showSessionSidebar:", error);
    ctx.ui.notify(
      `Error loading sessions: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }
}

/**
 * Show the folder overview overlay with drill-down to session list.
 * Uses a loop so Esc in drill-down returns to folder list.
 */
export async function showFolderSidebar(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Folder overview requires TUI mode.", "error");
    return;
  }

  ctx.ui.notify("Loading projects...", "info");

  try {
    const sessions = getSessions();
    const folders = groupSessionsByFolder(sessions);

    if (folders.length === 0) {
      ctx.ui.notify("No sessions found.", "info");
      return;
    }

    const overlayOptions = {
      anchor: "right-center" as const,
      width: SIDEBAR_WIDTH + 2,
      minWidth: 40,
      height: "55%",
      margin: 1,
    };

    // Navigation loop: folder list → session list → load or back
    // Safety limit prevents infinite loops from edge cases.
    let navDepth = 0;
    const MAX_NAV_DEPTH = 10;
    while (navDepth < MAX_NAV_DEPTH) {
      navDepth++;

      const folderResult = await ctx.ui.custom<FolderSummary | undefined>(
        (tui, theme, _keybindings, done) =>
          new FolderSidebarComponent(theme, folders, done, tui.terminal.rows),
        { overlay: true, overlayOptions },
      );

      if (!folderResult) break; // Esc → exit

      // Drill down: show sessions for this folder
      const sessionResult = await ctx.ui.custom<SessionSummary | undefined>(
        (tui, theme, _keybindings, done) =>
          new SessionSidebarComponent(
            theme,
            folderResult.sessions,
            done,
            tui.terminal.rows,
            `📁 ${folderResult.folder.replace(homedir(), "~")}`,
          ),
        { overlay: true, overlayOptions },
      );

      if (sessionResult) {
        ctx.ui.notify(`Loading session: ${sessionResult.name}`, "info");
        await loadSession(ctx, sessionResult.file);
        break; // session loaded
      }
      // sessionResult === undefined (Esc) → loop back to folder list
    }
  } catch (error) {
    console.error("[pi-sessions] Error in showFolderSidebar:", error);
    ctx.ui.notify(
      `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      "error",
    );
  }
}

/**
 * Load a session file by calling pi's native session switching.
 */
async function loadSession(
  ctx: ExtensionCommandContext,
  sessionFile: string,
): Promise<void> {
  try {
    // Use ctx.switchSession to load the selected session
    const result = await ctx.switchSession(sessionFile, {
      withSession: async (newCtx) => {
        newCtx.ui.notify("Session restored successfully", "info");
      },
    });

    if (result && "cancelled" in result && result.cancelled) {
      ctx.ui.notify("Session switch cancelled.", "warning");
    }
  } catch (error) {
    console.error(
      `[pi-sessions] Failed to switch to session ${sessionFile}:`,
      error instanceof Error ? error.message : error,
    );
    ctx.ui.notify(
      `Could not switch directly. Try /resume to select the session.`,
      "warning",
    );
  }
}
