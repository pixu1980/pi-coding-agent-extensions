/**
 * pi-sessions - package entry (barrel)
 *
 * Pi loads this file via `pi.extensions`; it only re-exports the extension
 * factory from `lib/`.
 */

import extension from './lib/index.ts';

export default extension;
