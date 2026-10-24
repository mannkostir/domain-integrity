import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type PackedFile = { readonly path: string };

type PackResult = { readonly files: readonly PackedFile[] };

const packedPaths = (): readonly string[] => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const [result] = JSON.parse(output) as readonly [PackResult];
  return result.files.map((file) => file.path);
};

const readRootFile = (name: string): string => readFileSync(join(ROOT, name), 'utf8');

const packageVersion = (): string => (JSON.parse(readRootFile('package.json')) as { readonly version: string }).version;

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
    const version = packageVersion();

    const headings = releaseHeadings(readRootFile('CHANGELOG.md'));

    expect(headings).toContain(version);
  });
});
