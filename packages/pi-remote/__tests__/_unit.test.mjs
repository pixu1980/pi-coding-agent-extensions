/**
 * pi-remote - unit tests (pairing URL, TTL, push scaffold, command basics)
 *
 * Run via the index.test.mjs barrel: node --import tsx --test __tests__/index.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import piRemoteExtension from '../index.ts';
import { QRSession, buildPairUrl, clampPairTtlMs, roomIdFor, TOKEN_TTL_MS } from '../lib/_pairing.ts';
import { buildWakeUpPayload, generateVapidKeys } from '../lib/_push.ts';
import { createMockPi, createMockCtx } from '../../../test/harness.mjs';

function lastUserMessage(calls) {
  const entry = calls.sendUserMessage.at(-1);
  assert.ok(entry, 'expected a user message to be sent');
  return entry[0];
}

// ── Pairing unit ─────────────────────────────────────────────────────

test('QRSession issues single-use tokens with TTL', () => {
  const qr = new QRSession();
  const { token } = qr.issueToken(60_000);
  assert.equal(qr.consumeToken(token), 'ok');
  assert.equal(qr.consumeToken(token), 'consumed');
  assert.equal(qr.consumeToken('nope'), 'unknown');
});

test('QRSession expires tokens', () => {
  const qr = new QRSession();
  const { token } = qr.issueToken(10);
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  try {
    assert.equal(qr.consumeToken(token), 'expired');
  } finally {
    Date.now = realNow;
  }
});

test('clampPairTtlMs bounds caller TTLs', () => {
  assert.equal(clampPairTtlMs(Number.NaN), TOKEN_TTL_MS);
  assert.equal(clampPairTtlMs(1), 10_000);
  assert.equal(clampPairTtlMs(1_000_000), 600_000);
  assert.equal(clampPairTtlMs(30_000), 30_000);
});

test('buildPairUrl points at the PWA, not a native scheme', () => {
  const url = buildPairUrl('https://example.test/pi-remote/', 'tok123', 'roomABC', 'my session', 'cGkraWQ9PT0=');
  assert.ok(url.startsWith('https://example.test/pi-remote/pair?'), url);
  assert.ok(url.includes('t=tok123'), url);
  assert.ok(url.includes('rm=roomABC'), url);
  assert.ok(url.includes('epk='), url);
});

test('roomIdFor is stable and 12 chars', () => {
  const a = roomIdFor('/Users/me/proj');
  assert.equal(a.length, 12);
  assert.equal(a, roomIdFor('/Users/me/proj'));
  assert.notEqual(a, roomIdFor('/Users/me/other'));
});

// ── Push unit ────────────────────────────────────────────────────────

test('generateVapidKeys returns a P-256 pair', () => {
  const keys = generateVapidKeys();
  assert.match(keys.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.ok(keys.privateKey.length > 0);
  assert.ok(keys.publicKey.length > 0);
});

test('wake-up payload carries no message content', () => {
  const payload = buildWakeUpPayload('roomABC');
  assert.ok(!payload.includes('prompt'), payload);
  assert.ok(payload.includes('wake-up'), payload);
});

// ── Extension factory ────────────────────────────────────────────────

test('registers the pi-remote command', () => {
  const { pi, commands } = createMockPi();
  piRemoteExtension(pi);
  assert.ok(commands.has('pi-remote'), 'pi-remote command registered');
});

test('direct token consume pairs (no relay)', async () => {
  const { pi, runCommand, calls } = createMockPi();
  const api = piRemoteExtension(pi);
  const ctx = createMockCtx({ cwd: '/tmp/pi-remote-test' });

  await runCommand('pi-remote', 'status', ctx);
  assert.match(lastUserMessage(calls), /idle/);

  // Pairing without start is refused; direct consume is the unit hook.
  await runCommand('pi-remote', 'pair', ctx);
  assert.match(lastUserMessage(calls), /start first/);
  assert.equal(api.getState(), 'idle');
});

test('pair before start asks to start first', async () => {
  const { pi, runCommand, calls } = createMockPi();
  piRemoteExtension(pi);
  await runCommand('pi-remote', 'pair', createMockCtx());
  assert.match(lastUserMessage(calls), /start first/);
});
