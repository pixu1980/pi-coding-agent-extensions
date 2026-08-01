import { join } from 'node:path';

export function standardVersionCommand(root, packageName, dryRun) {
  const executable = join(root, 'node_modules', '.bin', 'standard-version');
  const mode = dryRun ? '--dry-run' : '--no-verify';

  return `"${executable}" ${mode} --tag-prefix "${packageName}@"`;
}
