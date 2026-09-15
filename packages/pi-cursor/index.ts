/**
 * pi-cursor - package entry
 *
 * Pi loads this file via `pi.extensions`. The default export is re-exported
 * from `lib/` in two steps rather than as a direct re-export clause: this is a
 * package entry, not a component barrel, and the file-tree guardrail reads a
 * relative named re-export here as a component re-export.
 */

import extension from './lib/index.ts';

export default extension;
