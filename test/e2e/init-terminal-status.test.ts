import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LifecycleFinding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

const FIXTURE = fileURLToPath(new URL('../fixtures/terminal-status-timestamp', import.meta.url));
const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

type TsConfig = { compilerOptions: { paths: Record<string, string[]> } };

const pointHelpersAtRepo = (tsconfigPath: string): void => {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as TsConfig;
  const paths = { ...tsconfig.compilerOptions.paths, 'domain-integrity': [HELPERS_ENTRY] };
  writeFileSync(tsconfigPath, JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, paths } }));
};

const initialisedCopy = async (): Promise<string> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-terminal-status-')));
  cpSync(FIXTURE, dir, { recursive: true });
  pointHelpersAtRepo(join(dir, 'tsconfig.json'));
  await run(['init', '--yes'], captureIo(dir).io);
  return dir;
};

const describeFinding = ({ severity, checkId, aggregate, method, field, subject }: LifecycleFinding) => ({
  severity,
  checkId,
  aggregate,
  method,
  field,
  subject,
});

const checkJson = async (dir: string) => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: LifecycleFinding[] }).findings;
  return { code, findings: findings.map(describeFinding) };
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
          checkId: 'terminal-state-leak',
          aggregate: 'Ticket',
          method: 'rename',
          field: 'status',
          subject: 'CLOSED',
        },
      ],
    });
  });

  it('leaves the timestamp without terminal values', async () => {
    const dir = await initialisedCopy();

    const config = readFileSync(join(dir, 'domain.config.ts'), 'utf8');

    expect(config).toContain('closedAt: { terminal: [] }');
  });
});
