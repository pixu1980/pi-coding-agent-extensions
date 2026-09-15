/**
 * pi-cursor - egress suite
 *
 * These assertions are the contract behind the "no weird outbound traffic"
 * claim: only Cursor-owned HTTPS endpoints are accepted, and the SDK's backend
 * override is refused unless the user opted in explicitly.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertAllowedCursorEndpoint,
  checkBackendOverride,
  describeEgressSurface,
  formatEgressSurface,
  isAllowedCursorEndpoint,
  isAllowedCursorHost,
} from '../lib/_egress.ts';
import { CURSOR_EGRESS_ALLOWLIST } from '../lib/_types.ts';

describe('isAllowedCursorHost', () => {
  it('accepts the Cursor endpoints', () => {
    for (const host of CURSOR_EGRESS_ALLOWLIST) {
      assert.equal(isAllowedCursorHost(host), true);
    }
  });

  it('accepts subdomains of an allowed host', () => {
    assert.equal(isAllowedCursorHost('api2.cursor.sh'), true);
    assert.equal(isAllowedCursorHost('API.CURSOR.COM'), true);
    assert.equal(isAllowedCursorHost('api.cursor.com.'), true);
  });

  it('rejects lookalikes and unrelated hosts', () => {
    for (const host of [
      'api.cursor.com.evil.test',
      'evil-api.cursor.com.attacker.example',
      'cursor.com',
      'statsigapi.net',
      'featureassets.org',
      'api.statsigcdn.com',
      'prodregistryv2.org',
      'localhost',
      '127.0.0.1',
      '',
    ]) {
      assert.equal(isAllowedCursorHost(host), false, `${host} must not be allowed`);
    }
  });
});

describe('isAllowedCursorEndpoint', () => {
  it('requires https', () => {
    assert.equal(isAllowedCursorEndpoint('http://api.cursor.com/v1/models'), false);
    assert.equal(isAllowedCursorEndpoint('https://api.cursor.com/v1/models'), true);
    assert.equal(isAllowedCursorEndpoint('https://api2.cursor.sh/aiserver.v1.AnalyticsService/TrackEvents'), true);
  });

  it('rejects anything unparseable rather than guessing', () => {
    assert.equal(isAllowedCursorEndpoint(undefined), false);
    assert.equal(isAllowedCursorEndpoint('not a url'), false);
    assert.equal(isAllowedCursorEndpoint('https://'), false);
  });
});

describe('assertAllowedCursorEndpoint', () => {
  it('throws on a rejected endpoint', () => {
    assert.throws(() => assertAllowedCursorEndpoint('https://collector.example/ingest'), /only talks to/);
  });
});

describe('checkBackendOverride', () => {
  it('passes when the variable is unset', () => {
    assert.equal(checkBackendOverride({}).ok, true);
  });

  it('passes for a Cursor endpoint', () => {
    assert.equal(checkBackendOverride({ CURSOR_BACKEND_URL: 'https://api2.cursor.sh' }).ok, true);
  });

  it('fails closed for a foreign endpoint', () => {
    const result = checkBackendOverride({ CURSOR_BACKEND_URL: 'https://evil.example' });

    assert.equal(result.ok, false);
    assert.match(result.reason, /refuses to send your API key/);
  });

  it('fails closed for a plaintext or malformed override', () => {
    assert.equal(checkBackendOverride({ CURSOR_BACKEND_URL: 'http://api.cursor.com' }).ok, false);
    assert.equal(checkBackendOverride({ CURSOR_BACKEND_URL: '://nope' }).ok, false);
  });

  it('honors an explicit opt-in', () => {
    const result = checkBackendOverride({
      CURSOR_BACKEND_URL: 'https://cursor.internal.example',
      PI_CURSOR_ALLOW_BACKEND_OVERRIDE: '1',
    });

    assert.equal(result.ok, true);
    assert.match(result.reason, /PI_CURSOR_ALLOW_BACKEND_OVERRIDE/);
  });

  it('requires the opt-in to be exactly 1', () => {
    assert.equal(
      checkBackendOverride({ CURSOR_BACKEND_URL: 'https://evil.example', PI_CURSOR_ALLOW_BACKEND_OVERRIDE: 'true' }).ok,
      false
    );
  });
});

describe('describeEgressSurface', () => {
  it('reports that pi-cursor ships no HTTP client of its own', () => {
    const surface = describeEgressSurface({});

    assert.deepEqual(surface.extensionHttpClients, []);
    assert.deepEqual([...surface.hosts], [...CURSOR_EGRESS_ALLOWLIST]);
  });

  it('names the Cursor SDK call sites it drives', () => {
    const surface = describeEgressSurface({});

    assert.equal(surface.sdkCallSites.length, 3);
    assert.match(surface.sdkCallSites.join('\n'), /Cursor\.models\.list/);
    assert.match(surface.sdkCallSites.join('\n'), /agent\.send/);
  });

  it('renders a readable summary', () => {
    const text = formatEgressSurface(describeEgressSurface({}));

    assert.match(text, /HTTP clients owned by pi-cursor: none/);
    assert.match(text, /api\.cursor\.com/);
  });

  it('renders a blocked override', () => {
    const text = formatEgressSurface(describeEgressSurface({ CURSOR_BACKEND_URL: 'https://evil.example' }));

    assert.match(text, /BLOCKED/);
  });
});
