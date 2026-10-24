import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST } from './helpers/manifest';
import { packedPaths } from './helpers/pack';

const readChangelog = (): string => readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

const releaseHeadings = (changelog: string): readonly string[] =>
  changelog
    .split('\n')
    .filter((line) => line.startsWith('## ['))
    .map((line) => /^## \[([^\]]+)\]/.exec(line)?.[1] ?? '');

describe('published package', () => {
  it('ships the changelog', () => {
    const paths = packedPaths();

    expect(paths).toContain('CHANGELOG.md');
  });

  it('has a changelog section for the current version', () => {
    const version = MANIFEST.version;

    const headings = releaseHeadings(readChangelog());

    expect(headings).toContain(version);
  });
});
