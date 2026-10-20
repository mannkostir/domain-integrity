import { describe, expect, it } from 'vitest';
import { parseSarif } from '../helpers/sarif-log';

const VALID_LOG = { version: '2.1.0', runs: [{ tool: { driver: { name: 'domain-integrity', rules: [] } }, results: [] }] };

describe('parseSarif', () => {
  it('returns a log without violations', () => {
    expect(parseSarif(JSON.stringify(VALID_LOG))).toEqual(VALID_LOG);
  });

  it('rejects a log with violations, naming them', () => {
    const wrongVersion = JSON.stringify({ ...VALID_LOG, version: '2.0.0' });

    expect(() => parseSarif(wrongVersion)).toThrow('version is not 2.1.0');
  });
});
