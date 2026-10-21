import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { pointHelpersAtRepo } from '../helpers/init-project';

const FIXTURE = fileURLToPath(new URL('../fixtures/nx-monorepo', import.meta.url));
const BASELINE_ENTRIES = [
  {
    rule: 'outside-mutation',
    aggregate: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
    field: 'status',
    file: 'test/fixtures/nx-monorepo/apps/api/src/cancel-order.ts',
    scope: 'CancelOrder.execute',
    count: 1,
  },
  {
    rule: 'outside-mutation',
    aggregate: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
    field: 'status',
    file: 'test/fixtures/nx-monorepo/libs/orders/src/order-mapper.ts',
    scope: 'OrderMapper.reopen',
    count: 1,
  },
];

type WireOutsideMutation = {
  readonly ruleId: string;
  readonly location: { readonly file: string };
  readonly identity: { readonly aggregate: string };
  readonly details: { readonly scope: string };
};

const located = (finding: WireOutsideMutation) => ({
  ruleId: finding.ruleId,
  file: finding.location.file,
  aggregateId: finding.identity.aggregate,
  scope: finding.details.scope,
});

const checkFrom = async (cwd: string, tsconfig: string) => {
  const { io, stdout } = captureIo(cwd);
  const code = await run(['check', '--format', 'json', '-p', tsconfig], io);
  return { code, findings: (JSON.parse(stdout()) as { findings: WireOutsideMutation[] }).findings.map(located) };
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
          ruleId: 'outside-mutation',
          file: 'test/fixtures/nx-monorepo/apps/api/src/cancel-order.ts',
          aggregateId: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
          scope: 'CancelOrder.execute',
        },
        {
          ruleId: 'outside-mutation',
          file: 'test/fixtures/nx-monorepo/libs/orders/src/order-mapper.ts',
          aggregateId: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
          scope: 'OrderMapper.reopen',
        },
      ],
    });
  });

  it('analyses library files an app tsconfig reaches through paths', async () => {
    expect(await checkFrom(FIXTURE, 'apps/api/tsconfig.json')).toEqual({
      code: 1,
      findings: [
        {
          ruleId: 'outside-mutation',
          file: 'test/fixtures/nx-monorepo/apps/api/src/cancel-order.ts',
          aggregateId: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
          scope: 'CancelOrder.execute',
        },
        {
          ruleId: 'outside-mutation',
          file: 'test/fixtures/nx-monorepo/libs/orders/src/order-mapper.ts',
          aggregateId: 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order',
          scope: 'OrderMapper.reopen',
        },
      ],
    });
  });

  it('writes the same baseline entries on every run', async () => {
    const first = await baselineFrom(FIXTURE, 'apps/api/tsconfig.json');
    const second = await baselineFrom(FIXTURE, 'apps/api/tsconfig.json');

    expect([first, second]).toEqual([
      { version: 2, findings: BASELINE_ENTRIES },
      { version: 2, findings: BASELINE_ENTRIES },
    ]);
  });

  it('init imports the aggregate from its library path', async () => {
    const dir = await initialisedCopy();

    expect(readFileSync(join(dir, 'domain.config.ts'), 'utf8')).toContain("from './libs/orders/src/order'");
  });

  it('check reports against the config init wrote', async () => {
    const dir = await initialisedCopy();

    const { findings } = await checkFrom(dir, 'tsconfig.json');

    expect(findings.map((finding) => finding.ruleId)).toContain('outside-mutation');
  });
});
