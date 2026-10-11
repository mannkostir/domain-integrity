import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { Finding } from '../../src/analyzer';
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
  const parsed = ts.getParsedCommandLineOfConfigFile(join(dir, 'tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (parsed === undefined) throw new Error(`Cannot parse ${dir}/tsconfig.json`);
  const program = ts.createProgram({ rootNames: [...parsed.fileNames, configPath], options: parsed.options });
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(configPath))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
};

const describeFinding = (finding: Finding): string =>
  finding.analyzer === 'lifecycle'
    ? `${finding.severity} ${finding.checkId} ${finding.aggregate}.${finding.method ?? '-'} ${finding.field} ${finding.subject}`
    : `${finding.severity} ${finding.checkId}`;

const checkJson = async (dir: string) => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: Finding[] }).findings;
  return { code, findings: findings.map(describeFinding) };
};

describe('init in a NodeNext ESM project', () => {
  it('writes a config that check runs against', async () => {
    const dir = await initialisedCopy();

    const result = await checkJson(dir);

    expect(result).toEqual({
      code: 1,
      findings: ['error terminal-state-leak Shipment.redirect status DELIVERED'],
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
