/**
 * pi-web - SSRF guard: blocked ranges and the pinned lookup
 *
 * The transition prefixes matter because each one carries an IPv4 destination.
 * On a network that translates them, an unblocked prefix reaches loopback and
 * the cloud metadata address.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPinnedLookup, isBlockedAddress } from '../lib/_ssrf.ts';

const BLOCKED = [
  '127.0.0.1',
  '10.1.2.3',
  '169.254.169.254',
  '192.168.1.1',
  '100.64.0.1',
  '0.0.0.0',
  '::1',
  '::ffff:127.0.0.1',
  'fd00::1',
  'fe80::1',
  '64:ff9b::7f00:1',
  '64:ff9b::a9fe:a9fe',
  '64:ff9b:1::7f00:1',
  '2002:7f00:1::',
  '2001:0:0:0:0:0:7f00:1',
];

test('every private, loopback and transition address is blocked', () => {
  for (const address of BLOCKED) {
    assert.equal(isBlockedAddress(address, []), true, `${address} must be blocked`);
  }
});

test('public addresses stay reachable', () => {
  for (const address of ['17.0.0.1', '2606:4700::1111', '93.184.216.34']) {
    assert.equal(isBlockedAddress(address, []), false, `${address} must stay reachable`);
  }
});

test('an allowlisted range still reopens the address', () => {
  assert.equal(isBlockedAddress('127.0.0.1', ['127.0.0.1']), false);
  assert.equal(isBlockedAddress('64:ff9b::7f00:1', ['64:ff9b::/96']), false);
});

test('the pinned lookup answers with approved addresses only', () => {
  const lookup = createPinnedLookup(['93.184.216.34', '2606:4700::1111']);
  const seen = { single: null, all: null };

  lookup('rebind.test', {}, (err, address, family) => {
    seen.single = { err, address, family };
  });
  lookup('rebind.test', { all: true }, (err, addresses) => {
    seen.all = { err, addresses };
  });

  assert.equal(seen.single.err, null);
  assert.equal(seen.single.address, '93.184.216.34');
  assert.equal(seen.single.family, 4);
  assert.deepEqual(seen.all.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700::1111', family: 6 },
  ]);
  assert.ok(
    !JSON.stringify([seen.single, seen.all]).includes('127.0.0.1'),
    'a rebinding answer can never reach the connector'
  );
});

test('the pinned lookup fails closed when it has no approved address', () => {
  const lookup = createPinnedLookup([]);
  let failure = null;

  lookup('example.test', {}, (err) => {
    failure = err;
  });

  assert.ok(failure, 'an empty approved set must produce an error');
  assert.equal(failure.code, 'ENOTFOUND');
});

test('the pinned lookup ignores non-addresses', () => {
  const lookup = createPinnedLookup(['not-an-ip']);
  let failure = null;

  lookup('example.test', {}, (err) => {
    failure = err;
  });

  assert.equal(failure.code, 'ENOTFOUND');
});
