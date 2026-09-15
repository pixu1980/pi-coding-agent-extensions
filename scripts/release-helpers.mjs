import { join } from 'node:path';

/**
 * Ensures npm authentication is available before publishing packages.
 *
 * @param {{ whoami: () => void, login: () => void, log?: (message: string) => void }} options
 * @returns {void}
 */
export function ensureNpmAuthentication({ whoami, login, log = () => {} }) {
  try {
    whoami();

    return;
  } catch {
    log('⚠  npm not authenticated. Starting npm login...');
  }

  try {
    login();
    whoami();
  } catch (error) {
    throw new Error('npm login failed.', { cause: error });
  }
}

/**
 * Lists the files under `pkgDir` that changed since `tag`, keeping only the
 * ones that count as release-worthy.
 *
 * A file is NOT release-worthy when it is auto-generated and can change
 * without the package itself gaining new functionality — currently:
 *   - CHANGELOG.md  (regenerated per release; in this monorepo the central
 *     changelogs contain cross-package entries, so a commit that rewrites
 *     history wording touches every package's CHANGELOG without any of them
 *     actually changing)
 *
 * @param {string} tag git tag to diff from (the package's last release tag)
 * @param {string} pkgDir repository-relative package directory, e.g. 'packages/pi-ask'
 * @param {(cmd: string) => string} exec command runner bound to the repo cwd
 * @returns {string[]} release-worthy changed files; `null` when the diff could
 *   not be computed (unknown tag / git error) so callers can err on the side
 *   of releasing rather than silently skipping.
 */
export function changedFilesSinceTag(tag, pkgDir, exec) {
  let output;
  try {
    output = exec(`git diff --name-only "${tag}" -- "${pkgDir}"`);
  } catch {
    return null;
  }
  return output
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isReleaseTriggerFile);
}

/**
 * Whether a changed file should trigger a package release.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
export function isReleaseTriggerFile(relPath) {
  return !/\/CHANGELOG\.md$/.test(relPath);
}

/**
 * Builds the commit-and-tag-version invocation for one package.
 *
 * @param {string} root repository root, where the binary is installed
 * @param {string} packageName package name, used as the tag prefix
 * @param {boolean} dryRun simulate the release instead of writing it
 * @param {boolean} [firstRelease] omit the version bump for a package with no tag yet
 * @returns {string} the command to run from the package directory
 */
export function standardVersionCommand(root, packageName, dryRun, firstRelease = false) {
  const executable = join(root, 'node_modules', '.bin', 'commit-and-tag-version');
  const mode = dryRun ? '--dry-run' : '--no-verify';
  const firstReleaseFlag = firstRelease ? '--first-release ' : '';

  return `"${executable}" ${firstReleaseFlag}${mode} --tag-prefix "${packageName}@"`;
}

/**
 * The closing summary of a release run.
 *
 * A dry run never reaches the publish step, so it cannot report the `released`
 * counter: doing so made every dry run claim it had released nothing, even when
 * it had just decided to release the whole monorepo. The two counts are passed
 * in separately and only the one matching the mode is printed.
 *
 * @param {{ released: number, wouldRelease: number, skipped: number, total: number, dryRun: boolean }} counts
 * @returns {string[]} lines, ready to be logged one by one
 */
export function releaseSummaryLines({ released, wouldRelease, skipped, total, dryRun }) {
  const headline = dryRun ? `would release: ${wouldRelease}` : `released:     ${released}`;

  return ['  Summary:', `  - ${headline}`, `  - skipped:      ${skipped}`, `  - total pkgs:   ${total}`];
}
