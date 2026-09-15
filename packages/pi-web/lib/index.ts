/**
 * pi-web - public barrel (lib)
 *
 * Exposes the extension entry only; fetch/storage/format/ssrf modules stay
 * importable but are internal.
 */

import extension from './_extension.ts';

export default extension;
