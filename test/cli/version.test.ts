import { describe, expect, it } from 'vitest';
import { packageVersion, toolIdentity } from '../../src/cli/version';
import { MANIFEST } from '../helpers/manifest';

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
