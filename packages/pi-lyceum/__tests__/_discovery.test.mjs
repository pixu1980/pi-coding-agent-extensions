/**
 * pi-lyceum - discovery suite
 *
 * Exercises `GET /models` against injected `fetch` implementations, so the
 * suite never opens a socket and every guard (allowlist, cap, timeout, status)
 * is asserted on the request and response it actually receives.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchLiveModelIds, parseModelIds } from '../lib/_discovery.ts';
import { LYCEUM_BASE_URL, LYCEUM_MAX_CATALOG_CHARS } from '../lib/_types.ts';

const KEY = 'lk_test_0123456789';

/**
 * @param {unknown} body
 * @param {{ status?: number, statusText?: string, headers?: Record<string, string> }} [init]
 * @returns {Response}
 */
function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/**
 * @param {Response} response
 * @param {string} [url]
 * @returns {Response}
 */
function withUrl(response, url = `${LYCEUM_BASE_URL}/models`) {
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

/**
 * @param {string} text
 * @param {{ status?: number, statusText?: string, headers?: Record<string, string> }} [init]
 * @returns {Response}
 */
function textResponse(text, init = {}) {
  return new Response(text, {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: init.headers ?? {},
  });
}

describe('parseModelIds', () => {
  it('reads the documented OpenAI list shape', () => {
    const ids = parseModelIds(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'z-ai/glm-5.3', object: 'model' },
          { id: 'deepseek/deepseek-v4.1-flash', object: 'model' },
        ],
      })
    );

    assert.deepEqual(ids, ['z-ai/glm-5.3', 'deepseek/deepseek-v4.1-flash']);
  });

  it('drops embedding ids, blanks, non-strings and duplicates', () => {
    const ids = parseModelIds(
      JSON.stringify({
        data: [
          { id: 'z-ai/glm-5.3' },
          { id: 'qwen/qwen3-embedding-8b' },
          { id: '   ' },
          { id: 42 },
          { object: 'model' },
          'moonshotai/kimi-k3.1-pro',
          { id: 'z-ai/glm-5.3' },
        ],
      })
    );

    assert.deepEqual(ids, ['z-ai/glm-5.3', 'moonshotai/kimi-k3.1-pro']);
  });

  it('returns nothing for a payload without a data array', () => {
    assert.deepEqual(parseModelIds('{}'), []);
    assert.deepEqual(parseModelIds('{"data":"nope"}'), []);
    assert.deepEqual(parseModelIds('[]'), []);
  });
});

describe('fetchLiveModelIds', () => {
  it('requests the Lyceum model list with the bearer key and refuses redirects', async () => {
    /** @type {{ url?: string, init?: RequestInit }} */
    const seen = {};

    const ids = await fetchLiveModelIds({
      apiKey: `  ${KEY}  `,
      fetchImpl: async (url, init) => {
        seen.url = url;
        seen.init = init;
        return withUrl(jsonResponse({ data: [{ id: 'z-ai/glm-5.3' }] }));
      },
    });

    assert.deepEqual(ids, ['z-ai/glm-5.3']);
    assert.equal(seen.url, `${LYCEUM_BASE_URL}/models`);
    assert.equal(seen.init.method, 'GET');
    assert.equal(seen.init.redirect, 'error');
    assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(seen.init.headers.Accept, 'application/json');
    assert.ok(seen.init.signal instanceof AbortSignal);
  });

  it('reports the status and the provider message for a failed request', async () => {
    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        fetchImpl: async () =>
          textResponse(JSON.stringify({ error: { message: 'inference capacity exhausted', type: 'rate_limit' } }), {
            status: 429,
            statusText: 'Too Many Requests',
          }),
      }),
      /HTTP 429 Too Many Requests - inference capacity exhausted/
    );
  });

  it('reports a failure whose body is not JSON', async () => {
    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        fetchImpl: async () => textResponse('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
      }),
      /HTTP 502 Bad Gateway/
    );
  });

  it('refuses a response from a host outside the allowlist', async () => {
    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        fetchImpl: async () => withUrl(jsonResponse({ data: [] }), 'https://evil.test/openai/v1/models'),
      }),
      /outside the allowlist/
    );
  });

  it('refuses an oversized response', async () => {
    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        fetchImpl: async () =>
          textResponse('{"data":[]}', { headers: { 'content-length': String(LYCEUM_MAX_CATALOG_CHARS + 1) } }),
      }),
      /exceeds 1048576 characters/
    );

    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        fetchImpl: async () => textResponse(`{"data":[]}${' '.repeat(LYCEUM_MAX_CATALOG_CHARS)}`),
      }),
      /exceeds 1048576 characters/
    );
  });

  it('never calls fetch without a key', async () => {
    let called = false;

    await assert.rejects(
      fetchLiveModelIds({
        apiKey: '   ',
        fetchImpl: async () => {
          called = true;
          return withUrl(jsonResponse({ data: [] }));
        },
      }),
      /needs an API key/
    );

    assert.equal(called, false);
  });

  it('forwards pi cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by pi'));

    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        signal: controller.signal,
        fetchImpl: async (_url, init) => {
          assert.equal(init.signal.aborted, true);
          throw init.signal.reason;
        },
      }),
      /cancelled by pi/
    );
  });

  it('stops a request that outlives the timeout', async () => {
    await assert.rejects(
      fetchLiveModelIds({
        apiKey: KEY,
        timeoutMs: 5,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          }),
      })
    );
  });

  it('rejects a body that is not JSON', async () => {
    await assert.rejects(
      fetchLiveModelIds({ apiKey: KEY, fetchImpl: async () => withUrl(textResponse('not json')) }),
      SyntaxError
    );
  });
});
