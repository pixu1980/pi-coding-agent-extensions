import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(root, 'packages');

/**
 * The manifest of a direct dependency, read from the package's own
 * node_modules.
 *
 * The package directory is looked up directly rather than by resolving the
 * dependency's entry point. Resolving the entry fails for reasons that have
 * nothing to do with installation: `@modelcontextprotocol/sdk` ships an exports
 * map whose `require` target is absent from its tarball, so `require.resolve`
 * throws for a package that is installed and whose subpaths all work.
 *
 * @param {string} packageDir absolute path of the package that declares it
 * @param {string} dependency package name
 * @returns {Record<string, unknown> | null} the manifest, or null when the
 *   dependency is not installed locally and therefore cannot be inspected
 */
function dependencyManifest(packageDir, dependency) {
  const manifestPath = join(packageDir, 'node_modules', dependency, 'package.json');

  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

test('every package declares the non-optional peers its dependencies need', () => {
  const offenders = [];
  const unaudited = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, 'package.json');

    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const dependencyPackage = dependencyManifest(packageDir, dependency);

      if (dependencyPackage === null) {
        unaudited.push(`${manifest.name} -> ${dependency}`);
        continue;
      }

      const optional = dependencyPackage.peerDependenciesMeta ?? {};

      for (const [peer, range] of Object.entries(dependencyPackage.peerDependencies ?? {})) {
        if (optional[peer]?.optional === true || declared.has(peer)) {
          continue;
        }

        offenders.push(`${manifest.name} -> ${dependency} needs ${peer}@${range}, which nothing declares`);
      }
    }
  }

  assert.deepEqual(
    unaudited,
    [],
    `these dependencies are not installed, so their peers cannot be checked. Run pnpm install:\n${unaudited.join('\n')}`
  );

  assert.deepEqual(
    offenders,
    [],
    'pnpm installs a peer dependency on its own, which is why this passes locally while npm does not:\n' +
      'an npm consumer of a published package receives only what the manifest declares, and a missing\n' +
      `peer makes the extension fail to load at runtime. Declare each of these in the package's own dependencies:\n${offenders.join('\n')}`
  );
});

// Packages the host provides: pi is @earendil-works/pi-coding-agent, so it is
// already loaded in the process that runs an extension, and pi resolves these
// itself. Nothing else may be assumed present.
const hostProvided = [/^@earendil-works\//];

/**
 * Every bare specifier a package's own source imports at runtime.
 *
 * @param {string} packageDir absolute path of the package
 * @returns {Set<string>} module names, without node builtins or relative paths
 */
function importedSpecifiers(packageDir) {
  const specifiers = new Set();
  const sources = [join(packageDir, 'index.ts')];

  const libDir = join(packageDir, 'lib');

  if (existsSync(libDir)) {
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        sources.push(join(libDir, entry.name));
      }
    }
  }

  for (const source of sources) {
    if (!existsSync(source)) {
      continue;
    }

    const text = readFileSync(source, 'utf8');

    // Anchored to the statement forms, so the word "import" appearing in an
    // identifier or a message cannot match. `[^;'"]*?` spans newlines, which a
    // multi-line import needs, but stops at a semicolon or a quote so it cannot
    // run into the next statement.
    const patterns = [
      /^\s*import\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm,
      /^\s*import\s*['"]([^'"]+)['"]/gm,
      /^\s*export\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm,
      /\bimport\(\s*['"]([^'"]+)['"]/g,
      /\brequire\(\s*['"]([^'"]+)['"]/g,
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[1];

        if (specifier.startsWith('.') || specifier.startsWith('node:')) {
          continue;
        }

        specifiers.add(specifier);
      }
    }
  }

  return specifiers;
}

test('every bare specifier a package imports is declared as a dependency', () => {
  const offenders = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, 'package.json');

    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));

    for (const specifier of importedSpecifiers(packageDir)) {
      const packageName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];

      if (declared.has(packageName) || hostProvided.some((pattern) => pattern.test(packageName))) {
        continue;
      }

      offenders.push(`${manifest.name} imports ${packageName} but does not depend on it`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'pi installs extensions with --legacy-peer-deps, so a peerDependency is never installed.\n' +
      'Anything an extension imports at runtime has to be a real dependency, or an extension\n' +
      `can fail to load while working on the maintainer's machine, where pnpm filled the gap:\n${offenders.join('\n')}`
  );
});
