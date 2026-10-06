import { dirname, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { DomainIntegrityError } from '../engine/errors';
import { CheckOptions, checkCommand } from './check';
import { contextCommand } from './context';
import { initCommand } from './init';
import { Io, Paths } from './io';
import { showCommand } from './show';

type CommonOptions = { readonly project: string; readonly config: string };

const pathsFrom = (options: CommonOptions, io: Io): Paths => {
  const tsconfig = resolve(io.cwd, options.project);
  return { tsconfig, config: resolve(io.cwd, options.config), root: dirname(tsconfig) };
};

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <path>', 'path to tsconfig.json', 'tsconfig.json')
    .option('-c, --config <path>', 'path to domain.config.ts', 'domain.config.ts');

const buildProgram = (io: Io, outcome: { exitCode: number }): Command => {
  const program = new Command('domain-integrity')
    .description('Check aggregate lifecycles and in-process event flows against their declared intent.')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  withCommonOptions(program.command('check').description('report lifecycle and event-flow findings'))
    .option('--format <format>', 'text, json or sarif', 'text')
    .option('--baseline <path>', 'treat findings in this baseline file as known')
    .option('--update-baseline', 'write the current findings to the baseline file')
    .action((options: CheckOptions & CommonOptions) => {
      outcome.exitCode = checkCommand(pathsFrom(options, io), options, io);
    });

  withCommonOptions(program.command('show').description('print Mermaid state and event-flow diagrams').argument('[name]'))
    .action((name: string | undefined, options: CommonOptions) => {
      outcome.exitCode = showCommand(pathsFrom(options, io), name, io);
    });

  withCommonOptions(program.command('context').description('print or write the domain summary for agents'))
    .option('--write <file>', 'replace the domain-integrity section in this file')
    .action((options: CommonOptions & { readonly write?: string }) => {
      outcome.exitCode = contextCommand(pathsFrom(options, io), options.write, io);
    });

  withCommonOptions(program.command('init').description('suggest and write lifecycle declarations'))
    .option('-y, --yes', 'accept every suggestion without prompting')
    .action(async (options: CommonOptions & { readonly yes?: boolean }) => {
      outcome.exitCode = await initCommand(pathsFrom(options, io), options, io);
    });

  return program;
};

export const run = async (argv: readonly string[], io: Io): Promise<number> => {
  const outcome = { exitCode: 0 };
  try {
    await buildProgram(io, outcome).parseAsync([...argv], { from: 'user' });
    return outcome.exitCode;
  } catch (error) {
    if (error instanceof DomainIntegrityError) {
      io.err(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    throw error;
  }
};
