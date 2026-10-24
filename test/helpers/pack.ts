import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type PackResult = { readonly files: readonly { readonly path: string }[] };

const PACK_DRY_RUN = 'npm pack --dry-run --json --ignore-scripts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const packedPaths = (): readonly string[] => {
  const [result] = JSON.parse(execSync(PACK_DRY_RUN, { cwd: REPOSITORY_ROOT, encoding: 'utf8' })) as readonly [PackResult];
  return result.files.map((file) => file.path);
};
