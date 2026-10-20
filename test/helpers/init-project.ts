import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FindingOf } from '../../src/finding';
import { run } from '../../src/cli/run';
import { captureIo } from './disk';

const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

type TsConfig = { compilerOptions: { paths: Record<string, string[]> } };

export const pointHelpersAtRepo = (tsconfigPath: string): void => {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as TsConfig;
  const paths = { ...tsconfig.compilerOptions.paths, 'domain-integrity': [HELPERS_ENTRY] };
  writeFileSync(tsconfigPath, JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, paths } }));
};

const describeFinding = ({ severity, ruleId, details }: FindingOf<'terminal-state-leak'>) => ({
  severity,
  ruleId,
  aggregate: details.aggregate,
  method: details.method,
  field: details.field,
  values: details.values,
});

export const checkJsonText = async (dir: string): Promise<string> => {
  const { io, stdout } = captureIo(dir);
  await run(['check', '--format', 'json'], io);
  return stdout();
};

export const checkJson = async (dir: string) => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: FindingOf<'terminal-state-leak'>[] }).findings;
  return { code, findings: findings.map(describeFinding) };
};
