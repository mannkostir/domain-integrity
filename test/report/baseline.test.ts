import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { partitionByBaseline, readBaseline, serializeBaseline } from '../../src/report/baseline';
import { finding } from '../helpers/model';

const tempFile = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'baseline-')), 'baseline.json');
  writeFileSync(path, content);
  return path;
};

describe('baseline', () => {
  it('round-trips findings by key, independent of line numbers', () => {
    const baseline = readBaseline(tempFile(serializeBaseline([finding({ line: 10 })])));

    expect(partitionByBaseline([finding({ line: 99 }), finding({ method: 'other' })], baseline)).toEqual({
      fresh: [finding({ method: 'other' })],
      known: [finding({ line: 99 })],
    });
  });

  it('rejects a missing baseline file with a usage error', () => {
    expect(() => readBaseline('/definitely/missing/baseline.json')).toThrow(UsageError);
  });

  it('rejects an unreadable baseline path with a read error', () => {
    expect(() => readBaseline(mkdtempSync(join(tmpdir(), 'baseline-dir-')))).toThrow(/Cannot read baseline/);
  });

  it('rejects a file that is not a baseline', () => {
    expect(() => readBaseline(tempFile('{"nope": true}'))).toThrow(UsageError);
  });

  it('rejects invalid JSON', () => {
    expect(() => readBaseline(tempFile('not json'))).toThrow(UsageError);
  });
});
