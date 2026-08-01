/**
 * pi-sessions — internal constants (private module)
 */

export const SESSION_DIR_NAME = "sessions";
export const MAX_NAME_LENGTH = 60;
export const SIDEBAR_WIDTH = 68;
/** Maximum number of sessions to load (prevents OOM with thousands of files). */
export const MAX_SESSIONS = 500;
/** Cache TTL in milliseconds (5 minutes). */
export const CACHE_TTL_MS = 300_000;

/**
 * Overhead rows in the sidebar UI (borders, header, search bar, footer):
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
