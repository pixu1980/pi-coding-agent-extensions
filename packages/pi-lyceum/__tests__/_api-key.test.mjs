/**
 * pi-lyceum - API key suite
 *
 * Pins the only two things this package does with a key: normalize it, and
 * show a masked label that cannot reconstruct it.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { maskApiKey, normalizeApiKey, readStoredLyceumApiKey } from '../lib/_api-key.ts';

const KEY = 'lk_0123456789abcdefghijklmnopqrstuv';
const sandbox = mkdtempSync(join(tmpdir(), 'pi-lyceum-key-'));

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('normalizeApiKey', () => {
  it('keeps a real key and trims surrounding whitespace', () => {
    assert.equal(normalizeApiKey(`  ${KEY}\n`), KEY);
  });

  it('treats blank and non-string values as unconfigured', () => {
    for (const value of [undefined, null, 42, '', '   ', '\n\t']) {
      assert.equal(normalizeApiKey(value), undefined, `${JSON.stringify(value)} is not a key`);
    }
  });
});

describe('maskApiKey', () => {
  it('never reveals the whole key', () => {
    const masked = maskApiKey(KEY);

    assert.ok(!masked.includes(KEY));
    assert.match(masked, /^lk_0…stuv \(\d+ chars\)$/);
  });

  it('fully hides a short value', () => {
    assert.equal(maskApiKey('lk_short'), '••… (8 chars)');
  });
});

describe('readStoredLyceumApiKey', () => {
  it('reads the key pi stored for the lyceum provider', async () => {
    const authPath = join(sandbox, 'auth-with-key.json');

    writeFileSync(authPath, JSON.stringify({ lyceum: { type: 'api_key', key: KEY } }), 'utf8');

    assert.equal(await readStoredLyceumApiKey(authPath), KEY);
  });

  it('ignores another provider and a non-api-key credential', async () => {
    const authPath = join(sandbox, 'auth-other-provider.json');

    writeFileSync(
      authPath,
      JSON.stringify({ openai: { type: 'api_key', key: KEY }, lyceum: { type: 'oauth', access: 'token' } }),
      'utf8'
    );

    assert.equal(await readStoredLyceumApiKey(authPath), undefined);
  });

  it('returns nothing when the file is absent or unreadable', async () => {
    assert.equal(await readStoredLyceumApiKey(join(sandbox, 'missing.json')), undefined);

    const brokenPath = join(sandbox, 'auth-broken.json');

    writeFileSync(brokenPath, '{not json', 'utf8');

    assert.equal(await readStoredLyceumApiKey(brokenPath), undefined);
  });
});
