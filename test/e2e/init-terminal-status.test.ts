import { cpSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { checkJson, checkJsonText, pointHelpersAtRepo } from '../helpers/init-project';
import { validateReport } from '../helpers/schema';

const FIXTURE = fileURLToPath(new URL('../fixtures/terminal-status-timestamp', import.meta.url));

const initialisedCopy = async (): Promise<string> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-terminal-status-')));
  cpSync(FIXTURE, dir, { recursive: true });
  pointHelpersAtRepo(join(dir, 'tsconfig.json'));
  await run(['init', '--yes'], captureIo(dir).io);
  return dir;
};

describe('init for a timestamp set only alongside a terminal status', () => {
  it('writes a config whose check reports only the unguarded method', async () => {
    const dir = await initialisedCopy();

    const result = await checkJson(dir);

    expect(result).toEqual({
      code: 1,
      findings: [
        {
          severity: 'error',
          ruleId: 'terminal-state-leak',
          aggregate: 'Ticket',
          method: 'rename',
          field: 'status',
          values: ['CLOSED'],
        },
      ],
    });
  });

  it('leaves the timestamp without terminal values', async () => {
    const dir = await initialisedCopy();

    const config = readFileSync(join(dir, 'domain.config.ts'), 'utf8');

    expect(config).toContain('closedAt: {\n          terminal: [],\n');
  });

  it('writes a JSON report the schema accepts', async () => {
    const dir = await initialisedCopy();

    const report = await checkJsonText(dir);

    expect(validateReport(report)).toEqual([]);
  });
});
