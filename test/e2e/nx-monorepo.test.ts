import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Finding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { pointHelpersAtRepo } from '../helpers/init-project';

const FIXTURE = fileURLToPath(new URL('../fixtures/nx-monorepo', import.meta.url));
const BASELINE_KEY = 'outside-mutation|../../libs/orders/src/order.ts:Order||status|CancelOrder.execute';

const located = (finding: Finding) => ({
  checkId: finding.checkId,
  file: finding.file,
  aggregateId: finding.analyzer === 'lifecycle' ? finding.aggregateId : undefined,
  subject: finding.subject,
});

const checkFrom = async (cwd: string, tsconfig: string) => {
  const { io, stdout } = captureIo(cwd);
  const code = await run(['check', '--format', 'json', '-p', tsconfig], io);
  return { code, findings: (JSON.parse(stdout()) as { findings: Finding[] }).findings.map(located) };
};

const baselineFrom = async (cwd: string, tsconfig: string): Promise<unknown> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-nx-baseline-')));
  const path = join(dir, 'baseline.json');
  await run(['check', '-p', tsconfig, '--baseline', path, '--update-baseline'], captureIo(cwd).io);
  return JSON.parse(readFileSync(path, 'utf8'));
};

const initialisedCopy = async (): Promise<string> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-nx-init-')));
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, 'domain.config.ts'));
  pointHelpersAtRepo(join(dir, 'tsconfig.base.json'));
  await run(['init', '--yes'], captureIo(dir).io);
  return dir;
};

describe('Nx-style monorepo', () => {
  it('analyses a solution tsconfig through its references', async () => {
    expect(await checkFrom(FIXTURE, 'tsconfig.json')).toEqual({
      code: 1,
      findings: [
        {
          checkId: 'outside-mutation',
          file: 'apps/api/src/cancel-order.ts',
          aggregateId: 'libs/orders/src/order.ts:Order',
          subject: 'CancelOrder.execute',
        },
      ],
    });
  });

  it('analyses library files an app tsconfig reaches through paths', async () => {
    expect(await checkFrom(FIXTURE, 'apps/api/tsconfig.json')).toEqual({
      code: 1,
      findings: [
        {
          checkId: 'outside-mutation',
          file: 'src/cancel-order.ts',
          aggregateId: '../../libs/orders/src/order.ts:Order',
          subject: 'CancelOrder.execute',
        },
      ],
    });
  });

  it('writes the same baseline keys on every run', async () => {
    const first = await baselineFrom(FIXTURE, 'apps/api/tsconfig.json');
    const second = await baselineFrom(FIXTURE, 'apps/api/tsconfig.json');

    expect([first, second]).toEqual([
      { version: 1, findings: [BASELINE_KEY] },
      { version: 1, findings: [BASELINE_KEY] },
    ]);
  });

  it('init imports the aggregate from its library path', async () => {
    const dir = await initialisedCopy();

    expect(readFileSync(join(dir, 'domain.config.ts'), 'utf8')).toContain("from './libs/orders/src/order'");
  });

  it('check reports against the config init wrote', async () => {
    const dir = await initialisedCopy();

    const { findings } = await checkFrom(dir, 'tsconfig.json');

    expect(findings.map((finding) => finding.checkId)).toContain('outside-mutation');
  });
});
