/**
 * pi-cursor - scrub suite
 *
 * The key never has to be known for the first two assertions: any string that
 * looks like a credential carrier is redacted on sight.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskApiKey, scrubCredentialShapes, scrubError, scrubSecrets } from '../lib/_scrub.ts';

const KEY = 'crsr_live_abcdefghijklmnopqrstuvwxyz0123456789';

describe('scrubSecrets', () => {
  it('removes the exact key wherever it appears', () => {
    const message = `request failed: Authorization=Bearer ${KEY} (retry)`;
    const scrubbed = scrubSecrets(message, KEY);

    assert.ok(!scrubbed.includes(KEY));
    assert.ok(scrubbed.includes('[redacted]'));
  });

  it('removes a key embedded in a URL, path, or JSON blob', () => {
    const input = `{"apiKey":"${KEY}","url":"https://api.cursor.com/x?key=${KEY}"}`;
    const scrubbed = scrubSecrets(input, KEY);

    assert.equal(scrubbed.includes(KEY), false);
  });

  it('redacts credential shapes even without knowing the key', () => {
    const input = [
      'Authorization: Bearer sk-some-other-secret',
      'api_key=sk-live-1234567890',
      'cookie: session=abc123',
      'https://user:hunter2@api.cursor.com/v1/models',
    ].join('\n');
    const scrubbed = scrubCredentialShapes(input);

    assert.equal(scrubbed.includes('sk-some-other-secret'), false);
    assert.equal(scrubbed.includes('sk-live-1234567890'), false);
    assert.equal(scrubbed.includes('abc123'), false);
    assert.equal(scrubbed.includes('hunter2'), false);
  });

  it('leaves ordinary prose untouched', () => {
    const input = 'Cursor model grok-4.6 finished in 1200ms with 42 tokens.';

    assert.equal(scrubSecrets(input, KEY), input);
  });

  it('tolerates a missing key', () => {
    assert.equal(scrubSecrets('plain text'), 'plain text');
  });
});

describe('maskApiKey', () => {
  it('never reveals a usable key', () => {
    const masked = maskApiKey(KEY);

    assert.equal(masked.includes(KEY), false);
    assert.ok(masked.length < KEY.length);
    assert.ok(masked.startsWith(KEY.slice(0, 4)));
  });

  it('describes absence without inventing a value', () => {
    assert.equal(maskApiKey(undefined), '(none)');
    assert.equal(maskApiKey('   '), '(none)');
  });
});

describe('scrubError', () => {
  it('scrubs and flattens thrown values', () => {
    const error = new Error(`boom\n  Bearer ${KEY}\n  more`);
    const scrubbed = scrubError(error, KEY);

    assert.equal(scrubbed.includes(KEY), false);
    assert.equal(scrubbed.includes('\n'), false);
  });

  it('never throws on exotic values', () => {
    const circular = {};

    circular.self = circular;
    assert.equal(typeof scrubError(circular), 'string');
    assert.equal(scrubError(undefined), 'unknown error');
  });
});
