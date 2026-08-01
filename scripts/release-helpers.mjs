import { join } from 'node:path';

export function standardVersionCommand(root, packageName, dryRun, firstRelease = false) {
  const executable = join(root, 'node_modules', '.bin', 'commit-and-tag-version');
  const mode = dryRun ? '--dry-run' : '--no-verify';
  const firstReleaseFlag = firstRelease ? '--first-release ' : '';

  return `"${executable}" ${firstReleaseFlag}${mode} --tag-prefix "${packageName}@"`;
}
