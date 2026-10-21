import { dirname, join } from 'node:path';

export type GitEntryProbe = (path: string) => boolean;

const nearestWithGitEntry = (dir: string, hasGitEntry: GitEntryProbe): string | undefined => {
  if (hasGitEntry(join(dir, '.git'))) return dir;
  const parent = dirname(dir);
  return parent === dir ? undefined : nearestWithGitEntry(parent, hasGitEntry);
};

export const findRepositoryRoot = (start: string, hasGitEntry: GitEntryProbe): string => nearestWithGitEntry(start, hasGitEntry) ?? start;
