import { cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';
import { checkJson, pointHelpersAtRepo } from '../helpers/init-project';

const FIXTURE = fileURLToPath(new URL('../fixtures/custom-base-class', import.meta.url));
const PRINTED_COMMAND = /: npx domain-integrity (init --base-class <Name>.*)$/;

const fixtureCopy = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-base-class-')));
  cpSync(FIXTURE, dir, { recursive: true });
  pointHelpersAtRepo(join(dir, 'tsconfig.json'));
  return dir;
};

const printedArguments = (stderr: string, baseClass: string): readonly string[] =>
  (PRINTED_COMMAND.exec(stderr.trimEnd())?.[1] ?? '').replace('<Name>', baseClass).split(' ');

const firstInit = async (dir: string) => {
  const { io, stderr } = captureIo(dir);
  const code = await run(['init', '--yes'], io);
  return { code, stderr: stderr() };
};

const initFollowingPrintedCommand = async (): Promise<string> => {
  const dir = fixtureCopy();
  const { stderr } = await firstInit(dir);
  await run(printedArguments(stderr, 'Model'), captureIo(dir).io);
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

describe('init in a project whose aggregates extend their own base class', () => {
  it('exits 2 on the first run', async () => {
    const dir = fixtureCopy();

    const { code } = await firstInit(dir);

    expect(code).toBe(2);
  });

  it('ends the message with the init command to run', async () => {
    const dir = fixtureCopy();

    const { stderr } = await firstInit(dir);

    expect(printedArguments(stderr, 'Model')).toEqual(['init', '--base-class', 'Model', '--yes']);
  });

  it('lets check report the leak once the printed command has run', async () => {
    const dir = await initFollowingPrintedCommand();

    const result = await checkJson(dir);

    expect(result).toEqual({
      code: 1,
      findings: [
        {
          severity: 'error',
          ruleId: 'terminal-state-leak',
          aggregate: 'Subscription',
          method: 'changePlan',
          field: 'state',
          values: ['cancelled'],
        },
      ],
    });
  });

  it('writes a config the TypeScript compiler accepts', async () => {
    const dir = await initFollowingPrintedCommand();

    const diagnostics = configDiagnostics(dir);

    expect(diagnostics).toEqual([]);
  });
});
