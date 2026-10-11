import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LifecycleFinding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from './disk';

const HELPERS_ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

type TsConfig = { compilerOptions: { paths: Record<string, string[]> } };

export const pointHelpersAtRepo = (tsconfigPath: string): void => {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as TsConfig;
  const paths = { ...tsconfig.compilerOptions.paths, 'domain-integrity': [HELPERS_ENTRY] };
  writeFileSync(tsconfigPath, JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, paths } }));
};

const describeFinding = ({ severity, checkId, aggregate, method, field, subject }: LifecycleFinding) => ({
  severity,
  checkId,
  aggregate,
  method,
  field,
  subject,
});

export const checkJson = async (dir: string) => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: LifecycleFinding[] }).findings;
  return { code, findings: findings.map(describeFinding) };
};
