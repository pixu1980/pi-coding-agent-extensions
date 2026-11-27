/**
 * pi-lyceum - host import guard
 *
 * pi's extension loader maps a fixed set of host specifiers, and only the bare
 * package names among them. A static import of a host subpath resolves in a
 * checkout that installs pi-ai itself, then fails in an npm install, which is
 * how 0.1.0 broke on a newer host at load time. A dynamic import may name a
 * subpath because the resolver can fall back from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = fileURLToPath(new URL('../lib/', import.meta.url));

test('no static import names a host package subpath', () => {
  const offenders = [];

  for (const file of readdirSync(libDir).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(libDir, file), 'utf8');

    for (const match of source.matchAll(/^import\b[\s\S]*?from\s+'(@earendil-works\/pi-[\w-]+)\/([^']+)';/gm)) {
      offenders.push(`${file}: ${match[1]}/${match[2]}`);
    }
  }

  assert.deepEqual(offenders, [], 'a bare host specifier is the only one the loader maps');
});

test('the fallback for an older host stays dynamic', () => {
  const source = readFileSync(join(libDir, 'index.ts'), 'utf8');

  assert.match(source, /await import\('@earendil-works\/pi-ai'\)/, 'the root is resolved first');
  assert.match(
    source,
    /await import\('@earendil-works\/pi-ai\/api\/openai-completions\.lazy'\)/,
    'the subpath fallback exists'
  );
});
