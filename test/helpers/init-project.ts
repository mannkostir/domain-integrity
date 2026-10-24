import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FindingOf } from '../../src/finding';
import { run } from '../../src/cli/run';
import { configSourceFile, loadProject } from '../../src/engine/project';
import { readDeclaration } from '../../src/engine/read-config';
import { captureIo, writeProject } from './disk';
import { MODEL_SOURCES } from './init-sources';

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

export const readConfig = (dir: string): string => readFileSync(join(dir, 'domain.config.ts'), 'utf8');

export const declarationIn = (dir: string) =>
  readDeclaration(configSourceFile(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir), join(dir, 'domain.config.ts'), dir), 'domain.config.ts').declaration;

export const initWithBaseClass = async (config: string | undefined): Promise<string> => {
  const dir = writeProject(config === undefined ? MODEL_SOURCES : { ...MODEL_SOURCES, 'domain.config.ts': config });
  await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);
  return dir;
};
