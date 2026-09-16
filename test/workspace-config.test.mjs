import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Directories that never carry hand-written configuration.
const ignored = new Set(['.git', '.tokensave', 'node_modules']);

// What pnpm writes into `allowBuilds` when it finds build scripts it has
// ignored and nobody has decided about them. It is a prompt, not a value, and
// pnpm cannot read it as a boolean, so the state it describes stays ambiguous
// and every `pnpm <script>` in that package fails with ERR_PNPM_IGNORED_BUILDS.
const placeholder = 'set this to true or false';

/**
 * Recursively collect the configuration files in the repository.
 *
 * @param {string} directory
 * @returns {string[]} absolute paths
 */
function collectConfigFiles(directory) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...collectConfigFiles(full));
    } else if (/\.(json|ya?ml)$/.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

test("no configuration file carries pnpm's unfilled allowBuilds placeholder", () => {
  const offenders = [];

  for (const file of collectConfigFiles(root)) {
    if (readFileSync(file, 'utf8').includes(placeholder)) {
      offenders.push(file.slice(root.length + 1));
    }
  }

  assert.deepEqual(offenders, [], `these files still carry pnpm's unfilled placeholder:\n${offenders.join('\n')}`);
});

test('every allowBuilds entry is an explicit boolean', () => {
  const packagesDir = join(root, 'packages');
  const problems = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspaceFile = join(packagesDir, entry.name, 'pnpm-workspace.yaml');

    if (!existsSync(workspaceFile)) {
      continue;
    }

    let insideAllowBuilds = false;

    for (const line of readFileSync(workspaceFile, 'utf8').split('\n')) {
      if (/^\S/.test(line)) {
        insideAllowBuilds = line.startsWith('allowBuilds:');
        continue;
      }

      if (insideAllowBuilds && line.trim() !== '' && !/^\s+\S+:\s+(true|false)$/.test(line)) {
        problems.push(`${entry.name}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(problems, [], `allowBuilds needs an explicit boolean per package:\n${problems.join('\n')}`);
});

/**
 * Every manifest in the repository: the root one plus one per package. Each
 * package is a standalone pnpm project, so there is no workspace member list to
 * read them from.
 *
 * @returns {Array<{ path: string, json: Record<string, unknown> }>}
 */
function collectManifests() {
  const dirs = [
    root,
    ...readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, 'packages', entry.name)),
  ];

  return dirs
    .map((dir) => ({ path: join(dir, 'package.json') }))
    .filter((manifest) => existsSync(manifest.path))
    .map((manifest) => ({ path: manifest.path, json: JSON.parse(readFileSync(manifest.path, 'utf8')) }));
}

/**
 * Recursively collect every file with the given name, skipping the directories
 * that never hold hand-written files.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {string[]} absolute paths
 */
function findFiles(directory, name) {
  const found = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...findFiles(full, name));
    } else if (entry.name === name) {
      found.push(full);
    }
  }

  return found;
}

test('no npm lockfile exists anywhere in the repository', () => {
  const offenders = findFiles(root, 'package-lock.json').map((file) => file.slice(root.length + 1));

  assert.deepEqual(
    offenders,
    [],
    `this repository installs with pnpm, so these belong to npm by mistake and must be deleted:\n${offenders.join('\n')}`
  );
});

test('no manifest declares a package manager', () => {
  const offenders = collectManifests()
    .filter((manifest) => 'packageManager' in manifest.json)
    .map((manifest) => manifest.path.slice(root.length + 1));

  assert.deepEqual(
    offenders,
    [],
    `a packageManager field asks for corepack, which this repository does not use:\n${offenders.join('\n')}`
  );
});

test('no manifest declares workspaces', () => {
  const offenders = collectManifests()
    .filter((manifest) => 'workspaces' in manifest.json)
    .map((manifest) => manifest.path.slice(root.length + 1));

  assert.deepEqual(
    offenders,
    [],
    `each package here is a standalone pnpm project and the root is a script runner, so a workspaces field would change how every install resolves:\n${offenders.join('\n')}`
  );
});
