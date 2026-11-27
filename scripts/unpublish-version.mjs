#!/usr/bin/env node
/**
 * unpublish-version.mjs - remove one published version from npm, with the checks
 * that make the removal safe to attempt.
 *
 *   node scripts/unpublish-version.mjs @pixu1980/pi-lyceum@0.0.0-stage          # dry run
 *   node scripts/unpublish-version.mjs @pixu1980/pi-lyceum@0.0.0-stage --yes    # do it
 *
 * npm allows removing a single version only within 72 hours of publishing it.
 * After that the registry refuses, and the move left is `npm deprecate`, which
 * keeps the tarball resolvable and marks it as one nobody should install.
 *
 * Exit codes: 0 dry run or success, 2 the version is unknown, 3 the version is
 * older than the window, 4 a dist-tag points at the version, 5 bad arguments.
 */

import { execFileSync } from 'node:child_process';

const UNPUBLISH_WINDOW_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;

function fail(code, message) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

/** `npm view <pkg> <field> --json`, parsed. */
function npmView(packageName, field) {
  try {
    return JSON.parse(execFileSync('npm', ['view', packageName, field, '--json'], { encoding: 'utf8' }));
  } catch (error) {
    fail(2, `npm view ${packageName} ${field} failed: ${error.message}`);
  }
}

const args = process.argv.slice(2);
const spec = args.find((arg) => !arg.startsWith('-'));
const apply = args.includes('--yes');

if (!spec) {
  fail(5, 'usage: node scripts/unpublish-version.mjs <package>@<version> [--yes]');
}

const separator = spec.lastIndexOf('@');

if (separator <= 0) {
  fail(5, `expected <package>@<version>, got "${spec}"`);
}

const packageName = spec.slice(0, separator);
const version = spec.slice(separator + 1);

const times = npmView(packageName, 'time');
const publishedAt = times[version];

if (!publishedAt) {
  fail(2, `${spec} is not a published version of ${packageName}`);
}

const ageHours = (Date.now() - new Date(publishedAt).getTime()) / HOUR_MS;

if (ageHours > UNPUBLISH_WINDOW_HOURS) {
  fail(
    3,
    `${spec} was published ${ageHours.toFixed(1)} hours ago, past the ${UNPUBLISH_WINDOW_HOURS}-hour window.\n` +
      `  npm refuses. Mark it instead:\n` +
      `  npm deprecate ${spec} "Superseded: do not install this version"`
  );
}

const distTags = npmView(packageName, 'dist-tags');
const taggedAs = Object.entries(distTags).filter(([, taggedVersion]) => taggedVersion === version);

if (taggedAs.length > 0) {
  fail(
    4,
    `${spec} carries the dist-tag ${taggedAs.map(([tag]) => tag).join(', ')}.\n` +
      `  Unpublishing it would leave that tag pointing at nothing. Move the tag first,\n` +
      `  then unpublish.`
  );
}

const versions = npmView(packageName, 'versions');
const remaining = versions.filter((other) => other !== version);

if (remaining.length === 0) {
  console.log(`⚠  ${packageName} has no other published version. Removing ${version} leaves the name free.`);
}

const command = ['npm', 'unpublish', spec];

console.log(`package:   ${packageName}`);
console.log(`version:   ${version}`);
console.log(`published: ${publishedAt} (${ageHours.toFixed(1)} hours ago, window is ${UNPUBLISH_WINDOW_HOURS})`);
console.log(
  `dist-tags: ${
    Object.entries(distTags)
      .map(([tag, value]) => `${tag}=${value}`)
      .join(', ') || 'none'
  }`
);
console.log(`others:    ${remaining.length} version(s) stay published`);
console.log(`command:   ${command.join(' ')}`);

if (!apply) {
  console.log('\nDry run. Re-run with --yes to remove it.');
  process.exit(0);
}

console.log('');
execFileSync(command[0], command.slice(1), { stdio: 'inherit' });
console.log(`\n✓ removed ${spec}`);
