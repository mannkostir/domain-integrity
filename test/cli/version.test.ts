import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageVersion, toolIdentity, toolIdentityAt } from '../../src/cli/version';
import { MANIFEST } from '../helpers/manifest';

const packageDirectory = (manifest?: Readonly<Record<string, unknown>>): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-version-')));
  if (manifest) writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  const nested = join(root, 'dist', 'cli');
  mkdirSync(nested, { recursive: true });
  return nested;
};

describe('packageVersion', () => {
  it('reads the version of the domain-integrity package', () => {
    expect(packageVersion()).toBe(MANIFEST.version);
  });
});

describe('toolIdentity', () => {
  it('identifies the package by name, version and homepage', () => {
    expect(toolIdentity()).toEqual({ name: 'domain-integrity', version: MANIFEST.version, informationUri: MANIFEST.homepage });
  });
});

describe('toolIdentityAt', () => {
  it('reads the version and homepage from the nearest domain-integrity manifest above the directory', () => {
    const directory = packageDirectory({ name: 'domain-integrity', version: '9.9.9', homepage: 'https://example.test/home' });

    expect(toolIdentityAt(directory)).toEqual({ name: 'domain-integrity', version: '9.9.9', informationUri: 'https://example.test/home' });
  });

  it('omits the information uri when the manifest has no homepage', () => {
    const directory = packageDirectory({ name: 'domain-integrity', version: '9.9.9' });

    expect(toolIdentityAt(directory)).toEqual({ name: 'domain-integrity', version: '9.9.9' });
  });

  it('ignores the manifest of another package', () => {
    const directory = packageDirectory({ name: 'other', version: '1.0.0', homepage: 'https://example.test/other' });

    expect(toolIdentityAt(directory)).toEqual({ name: 'domain-integrity', version: 'unknown version' });
  });

  it('reports an unknown version without an information uri when no manifest is found', () => {
    const directory = packageDirectory();

    expect(toolIdentityAt(directory)).toEqual({ name: 'domain-integrity', version: 'unknown version' });
  });
});
