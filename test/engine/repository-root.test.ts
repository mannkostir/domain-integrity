import { describe, expect, it } from 'vitest';
import { findRepositoryRoot } from '../../src/engine/repository-root';

const probeFor = (gitEntries: readonly string[]) => (path: string): boolean => gitEntries.includes(path);

describe('findRepositoryRoot', () => {
  it('finds the directory holding .git above the start', () => {
    expect(findRepositoryRoot('/repo/packages/api', probeFor(['/repo/.git']))).toBe('/repo');
  });

  it('accepts the start directory itself', () => {
    expect(findRepositoryRoot('/repo', probeFor(['/repo/.git']))).toBe('/repo');
  });

  it('takes the nearest of nested repositories', () => {
    expect(findRepositoryRoot('/outer/inner/pkg', probeFor(['/outer/.git', '/outer/inner/.git']))).toBe('/outer/inner');
  });

  it('falls back to the start outside any repository', () => {
    expect(findRepositoryRoot('/tmp/project', probeFor([]))).toBe('/tmp/project');
  });
});
