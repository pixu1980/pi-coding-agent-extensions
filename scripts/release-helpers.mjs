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
    log('⚠  npm non autenticato. Avvio npm login...');
  }

  try {
    login();
    whoami();
  } catch (error) {
    throw new Error('npm login non riuscito.', { cause: error });
  }
}

export function standardVersionCommand(root, packageName, dryRun, firstRelease = false) {
  const executable = join(root, 'node_modules', '.bin', 'commit-and-tag-version');
  const mode = dryRun ? '--dry-run' : '--no-verify';
  const firstReleaseFlag = firstRelease ? '--first-release ' : '';

  return `"${executable}" ${firstReleaseFlag}${mode} --tag-prefix "${packageName}@"`;
}
