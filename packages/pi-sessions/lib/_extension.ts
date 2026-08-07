/**
 * pi-sessions - extension entry (factory)
 *
 * Registers /sessions and /projects overlays and auto-names sessions from
 * the first user message.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { autoNameSession } from "./_sessions.ts";
import { showSessionSidebar, showFolderSidebar } from "./_overlays.ts";

export default function (pi: ExtensionAPI): void {
  // ── Register /sessions (centered modal) ──
  pi.registerCommand("sessions", {
    description: "Open session history modal. Navigate ↑↓, type to filter, Enter to restore.",
    handler: async (_args: string, ctx) => {
      await showSessionSidebar(ctx);
    },
  });

  // ── Register /projects (centered project modal with drill-down) ──
  pi.registerCommand("projects", {
    description: "Browse sessions by project directory. Shows aggregated info per project with drill-down to individual sessions.",
    handler: async (_args: string, ctx) => {
      await showFolderSidebar(ctx);
    },
  });

  // ── Auto-name sessions on start ───────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // If session has no display name, try to derive one from the first user message
    const currentName = pi.getSessionName();
    if (!currentName) {
      const entries = ctx.sessionManager.getEntries();
      for (const entry of entries) {
        if (
          entry.type === "message" &&
          entry.message &&
          "role" in entry.message &&
          entry.message.role === "user"
        ) {
          const name = autoNameSession(entry.message.content);
          if (name && name !== "Empty session") {
            pi.setSessionName(name);
          }
          break;
        }
      }
    }
  });
}
