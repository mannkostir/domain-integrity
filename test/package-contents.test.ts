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

  it('requires npm provenance on every publish', () => {
    const publishConfig = MANIFEST.publishConfig;

    const provenance = publishConfig?.provenance;

    expect(provenance).toBe(true);
  });

  it('exports the library entry as ESM only, for import and for require of ESM', () => {
    const libraryEntry = MANIFEST.exports['.'];

    const conditions = Object.keys(libraryEntry);

    expect(conditions).toEqual(['types', 'module-sync', 'import']);
  });
});
