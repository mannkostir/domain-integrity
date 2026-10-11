import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LifecycleFinding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

const FIXTURE = fileURLToPath(new URL('../fixtures/nodenext-esm', import.meta.url));
const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

type TsConfig = { compilerOptions: { paths: Record<string, string[]> } };

const pointHelpersAtRepo = (tsconfigPath: string): void => {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as TsConfig;
  const paths = { ...tsconfig.compilerOptions.paths, 'domain-integrity': [HELPERS_ENTRY] };
  writeFileSync(tsconfigPath, JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, paths } }));
};

const initialisedCopy = async (): Promise<string> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-nodenext-')));
  cpSync(FIXTURE, dir, { recursive: true });
  pointHelpersAtRepo(join(dir, 'tsconfig.json'));
  await run(['init', '--yes'], captureIo(dir).io);
  return dir;
};

const configDiagnostics = (dir: string): readonly string[] => {
  const configPath = join(dir, 'domain.config.ts');
  const { config } = ts.readConfigFile(join(dir, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir);
  const program = ts.createProgram({ rootNames: [...parsed.fileNames, configPath], options: parsed.options });
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(configPath))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
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

describe('init in a NodeNext ESM project', () => {
  it('writes a config that check runs against', async () => {
    const dir = await initialisedCopy();

    const result = await checkJson(dir);

    expect(result).toEqual({
      code: 1,
      findings: [
        {
          severity: 'error',
          checkId: 'terminal-state-leak',
          aggregate: 'Shipment',
          method: 'redirect',
          field: 'status',
          subject: 'DELIVERED',
        },
      ],
    });
  });

  it('writes a config the TypeScript compiler accepts', async () => {
    const dir = await initialisedCopy();

    const diagnostics = configDiagnostics(dir);

    expect(diagnostics).toEqual([]);
  });

  it('imports project modules with runtime extensions', async () => {
    const dir = await initialisedCopy();

    const config = readFileSync(join(dir, 'domain.config.ts'), 'utf8');

    expect(config).toContain("from './src/shipment.js'");
  });
});
