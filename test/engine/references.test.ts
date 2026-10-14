import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectError } from '../../src/engine/errors';
import { ReferenceRead, readReferencesFromDisk, referencedTsconfigs } from '../../src/engine/references';
import { writeTree } from '../helpers/disk';

const graph = (edges: Readonly<Record<string, ReferenceRead>>) => (tsconfig: string): ReferenceRead =>
  edges[tsconfig] ?? { kind: 'missing' };

const read = (...references: string[]): ReferenceRead => ({ kind: 'read', references });

describe('referencedTsconfigs', () => {
  it('returns nothing for a tsconfig without references', () => {
    expect(referencedTsconfigs('/r/tsconfig.json', graph({ '/r/tsconfig.json': read() }))).toEqual([]);
  });

  it('follows nested references depth-first', () => {
    const edges = graph({
      '/r/tsconfig.json': read('/r/apps/api/tsconfig.json', '/r/libs/orders/tsconfig.json'),
      '/r/apps/api/tsconfig.json': read('/r/libs/orders/tsconfig.json'),
      '/r/libs/orders/tsconfig.json': read('/r/libs/orders/tsconfig.lib.json'),
      '/r/libs/orders/tsconfig.lib.json': read(),
    });

    expect(referencedTsconfigs('/r/tsconfig.json', edges)).toEqual([
      '/r/apps/api/tsconfig.json',
      '/r/libs/orders/tsconfig.json',
      '/r/libs/orders/tsconfig.lib.json',
    ]);
  });

  it('stops at a cycle', () => {
    const edges = graph({
      '/r/tsconfig.json': read('/r/a/tsconfig.json'),
      '/r/a/tsconfig.json': read('/r/tsconfig.json'),
    });

    expect(referencedTsconfigs('/r/tsconfig.json', edges)).toEqual(['/r/a/tsconfig.json']);
  });

  it('names the referrer of a missing tsconfig', () => {
    const edges = graph({ '/r/tsconfig.json': read('/r/gone/tsconfig.json') });

    expect(() => referencedTsconfigs('/r/tsconfig.json', edges)).toThrow(
      new ProjectError('tsconfig not found: /r/gone/tsconfig.json (referenced from /r/tsconfig.json)'),
    );
  });

  it('names the referrer of an unreadable tsconfig', () => {
    const edges = graph({
      '/r/tsconfig.json': read('/r/bad/tsconfig.json'),
      '/r/bad/tsconfig.json': { kind: 'unreadable', reason: 'boom' },
    });

    expect(() => referencedTsconfigs('/r/tsconfig.json', edges)).toThrow(
      new ProjectError('Cannot load /r/bad/tsconfig.json (referenced from /r/tsconfig.json): boom'),
    );
  });
});

describe('readReferencesFromDisk', () => {
  it('resolves a directory reference to its tsconfig.json and keeps a file reference', () => {
    const dir = writeTree({
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './apps/api' }, { path: './libs/orders/tsconfig.lib.json' }] }),
    });

    expect(readReferencesFromDisk(join(dir, 'tsconfig.json'))).toEqual(
      read(join(dir, 'apps/api/tsconfig.json'), join(dir, 'libs/orders/tsconfig.lib.json')),
    );
  });

  it('reports a missing tsconfig', () => {
    expect(readReferencesFromDisk('/definitely/missing/tsconfig.json')).toEqual({ kind: 'missing' });
  });

  it('reports malformed JSON as unreadable', () => {
    const dir = writeTree({ 'tsconfig.json': '{ "files": [' });

    expect(readReferencesFromDisk(join(dir, 'tsconfig.json'))).toMatchObject({ kind: 'unreadable' });
  });
});
