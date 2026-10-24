import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepositoryRoot } from '../../src/engine/repository-root';

const probeFor = (gitEntries: readonly string[]) => (path: string): boolean => gitEntries.map((entry) => resolve(entry)).includes(path);

describe('findRepositoryRoot', () => {
  it('finds the directory holding .git above the start', () => {
    expect(findRepositoryRoot(resolve('/repo/packages/api'), probeFor(['/repo/.git']))).toBe(resolve('/repo'));
  });

  it('accepts the start directory itself', () => {
    expect(findRepositoryRoot(resolve('/repo'), probeFor(['/repo/.git']))).toBe(resolve('/repo'));
  });

  it('takes the nearest of nested repositories', () => {
    expect(findRepositoryRoot(resolve('/outer/inner/pkg'), probeFor(['/outer/.git', '/outer/inner/.git']))).toBe(resolve('/outer/inner'));
  });

  it('falls back to the start outside any repository', () => {
    expect(findRepositoryRoot(resolve('/tmp/project'), probeFor([]))).toBe(resolve('/tmp/project'));
  });
});
