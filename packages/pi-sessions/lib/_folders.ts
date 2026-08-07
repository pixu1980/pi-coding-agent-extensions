/**
 * pi-sessions - folder grouping (private module)
 */

import type { SessionSummary, FolderSummary } from "./_types.ts";

/**
 * Group sessions by project directory (cwd).
 * Returns folders sorted by latest session date, newest first.
 */
export function groupSessionsByFolder(sessions: SessionSummary[]): FolderSummary[] {
  const groups = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const folder = session.cwd || "unknown";
    const existing = groups.get(folder);
    if (existing) {
      existing.push(session);
    } else {
      groups.set(folder, [session]);
    }
  }

  const folders: FolderSummary[] = [];
  for (const [folder, folderSessions] of groups) {
    const latestSession = folderSessions[0]!;
    const totalMessages = folderSessions.reduce((sum, s) => sum + s.messageCount, 0);
    folders.push({
      folder,
      sessions: folderSessions,
      sessionCount: folderSessions.length,
      totalMessages,
      latestDate: latestSession.date,
      latestModel: latestSession.model,
      lastUserMessage: latestSession.lastUserMessage,
    });
  }

  folders.sort((a, b) => {
    return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
  });

  return folders;
}
