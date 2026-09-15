/**
 * pi-sessions - internal constants (private module)
 */

export const SESSION_DIR_NAME = 'sessions';
export const MAX_NAME_LENGTH = 60;
/** Match the centered /mcp panel width. */
export const MODAL_WIDTH = 82;
/**
 * Maximum number of sessions to load (prevents OOM with thousands of files).
 */
export const MAX_SESSIONS = 500;
/**
 * Summary scan cap per session file: discovery only needs the header, the
 * first user message and a sample of metadata, so a pathological JSONL is
 * never read in full. messageCount becomes an upper-bound estimate beyond
 * this cap.
 */
export const MAX_SESSION_SCAN_LINES = 50_000;
/** Cache TTL in milliseconds (5 minutes). */
export const CACHE_TTL_MS = 300_000;

/**
 * Overhead rows in the modal UI (borders, header, search bar, footer):
 *   ┌────┐   top border
 *   │    │   header (Sessions)
 *   ├────┤   separator
 *   │    │   search bar
 *   ├────┤   separator
 *   │    │   session items (variable)
 *   ├────┤   separator
 *   │    │   footer hint
 *   └────┘   bottom border
 * = 8 fixed rows
 */
export const SIDEBAR_OVERHEAD = 8;
