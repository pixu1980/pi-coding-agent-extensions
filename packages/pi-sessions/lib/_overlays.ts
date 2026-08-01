/**
 * pi-sessions — overlay flows (private module)
 *
 * /sessions and /projects overlay logic plus session restore.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { MODAL_WIDTH } from "./_constants.ts";
import type { SessionSummary, FolderSummary } from "./_types.ts";
import { getSessions } from "./_sessions.ts";
import { groupSessionsByFolder } from "./_folders.ts";
import { SessionCatalogModalComponent } from "./_components.ts";

const MODAL_OPTIONS = {
  overlay: true,
  overlayOptions: { anchor: "center" as const, width: MODAL_WIDTH },
};

/**
 * Show the session history overlay (popup mode).
 */
export async function showSessionSidebar(ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Session overlay requires TUI mode.", "error");
    return;
  }

  const result = await ctx.ui.custom<SessionSummary | undefined>(
    (tui, theme, _keybindings, done) => {
      const modal = new SessionCatalogModalComponent(
        theme,
        (selection) => done(selection as SessionSummary | undefined),
        tui.terminal.rows,
        "📋 Sessions",
        "Loading sessions...",
      );
      void getSessions((loaded, total) => {
        modal.setProgress(loaded, total);
        tui.requestRender();
      }).then((sessions) => {
        modal.showSessions(sessions);
        tui.requestRender();
      }).catch((error) => {
        modal.showError(error);
        tui.requestRender();
      });
      return modal;
    },
    MODAL_OPTIONS,
  );

  if (result) {
    await loadSession(ctx, result.file);
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

  let folders: FolderSummary[] = [];
  let catalogueLoaded = false;
  let navDepth = 0;
  const MAX_NAV_DEPTH = 10;

  while (navDepth < MAX_NAV_DEPTH) {
    navDepth++;

    const folderResult = await ctx.ui.custom<FolderSummary | undefined>(
      (tui, theme, _keybindings, done) => {
        const modal = new SessionCatalogModalComponent(
          theme,
          (selection) => done(selection as FolderSummary | undefined),
          tui.terminal.rows,
          "📁 Projects",
          "Loading projects...",
        );

        if (catalogueLoaded) {
          modal.showFolders(folders);
        } else {
          void getSessions((loaded, total) => {
            modal.setProgress(loaded, total);
            tui.requestRender();
          }).then((sessions) => {
            folders = groupSessionsByFolder(sessions);
            catalogueLoaded = true;
            modal.showFolders(folders);
            tui.requestRender();
          }).catch((error) => {
            modal.showError(error);
            tui.requestRender();
          });
        }

        return modal;
      },
      MODAL_OPTIONS,
    );

    if (!folderResult) break;

    const sessionResult = await ctx.ui.custom<SessionSummary | undefined>(
      (tui, theme, _keybindings, done) => {
        const modal = new SessionCatalogModalComponent(
          theme,
          (selection) => done(selection as SessionSummary | undefined),
          tui.terminal.rows,
          `📁 ${folderResult.folder.replace(homedir(), "~")}`,
          "Loading sessions...",
        );
        modal.showSessions(
          folderResult.sessions,
          `📁 ${folderResult.folder.replace(homedir(), "~")}`,
        );
        return modal;
      },
      MODAL_OPTIONS,
    );

    if (sessionResult) {
      await loadSession(ctx, sessionResult.file);
      break;
    }
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
