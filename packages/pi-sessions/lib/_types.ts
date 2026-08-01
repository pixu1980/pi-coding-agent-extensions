/**
 * pi-sessions — internal types (private module)
 */

export interface SessionSummary {
  /** Full path to the session JSONL file */
  file: string;
  /** Auto-generated name from first user message */
  name: string;
  /** ISO timestamp of first message */
  date: string;
  /** Total message count (user + assistant + tool) */
  messageCount: number;
  /** Model used (from last assistant message) */
  model?: string;
  /** Provider used */
  provider?: string;
  /** CWD when session was created */
  cwd?: string;
  /** Last modified time (file mtime) */
  mtime: number;
  /** Last user message content (truncated) */
  lastUserMessage?: string;
}

export interface FolderSummary {
  /** Project directory path */
  folder: string;
  /** Sessions in this folder (newest first) */
  sessions: SessionSummary[];
  /** Number of sessions in this folder */
  sessionCount: number;
  /** Total messages across all sessions in this folder */
  totalMessages: number;
  /** ISO timestamp of the most recent session */
  latestDate: string;
  /** Model used in the most recent session */
  latestModel?: string;
  /** Last user message from the most recent session */
  lastUserMessage?: string;
}

/** Type guard for a text content block in a message content array. */
export interface TextContentBlock {
  type: "text";
  text: string;
}
