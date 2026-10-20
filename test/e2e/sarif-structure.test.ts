import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { sarifViolations } from '../helpers/sarif-structure';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const sarifReport = async (name: string): Promise<unknown> => {
  const { io, stdout } = captureIo(fixture(name));
  await run(['check', '--format', 'sarif'], io);
  return JSON.parse(stdout());
};

describe('SARIF report structure', () => {
  it('is valid SARIF for the outside-spec fixture', async () => {
    expect(sarifViolations(await sarifReport('outside-spec'))).toEqual([]);
  });

  it('is valid SARIF for the event-flows fixture', async () => {
    expect(sarifViolations(await sarifReport('event-flows'))).toEqual([]);
  });
});
