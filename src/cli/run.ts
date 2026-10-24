import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { AnalyzerRun, DEFAULT_ANALYZERS } from '../analysis';
import { DomainIntegrityError } from '../engine/errors';
import { findRepositoryRoot } from '../engine/repository-root';
import { CheckOptions, DEFAULT_BASELINE, FORMATS, checkCommand } from './check';
import { contextCommand } from './context';
import { InitOptions, initCommand } from './init';
import { DEFAULT_CONFIG, DEFAULT_TSCONFIG, Io, Paths } from './io';
import { showCommand } from './show';
import { packageVersion, toolIdentity } from './version';

type CommonOptions = { readonly project: string; readonly config: string };

const collect = (value: string, previous: readonly string[] | undefined): readonly string[] => [...(previous ?? []), value];

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

const tsconfigAt = (given: string): string => (isDirectory(given) ? join(given, DEFAULT_TSCONFIG) : given);

const pathsFrom = (options: CommonOptions, io: Io): Paths => {
  const tsconfig = tsconfigAt(resolve(io.cwd, options.project));
  const projectRoot = dirname(tsconfig);
  return { tsconfig, config: resolve(io.cwd, options.config), projectRoot, repositoryRoot: findRepositoryRoot(projectRoot, existsSync) };
};

const HELP_WIDTH = 80;

const EXAMPLES = [
  'domain-integrity init',
  'domain-integrity check',
  'domain-integrity check -p packages/orders --format sarif',
  'domain-integrity show Order',
  'domain-integrity context --write AGENTS.md',
] as const;

const EXAMPLES_FOOTER = ['', 'Examples:', ...EXAMPLES.map((example) => `  ${example}`)].join('\n');

const alternatives = (values: readonly string[]): string => `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`;

const withDocsLink = (command: Command): Command => {
  const docs = toolIdentity().informationUri;
  return docs === undefined ? command : command.addHelpText('afterAll', `\nDocs: ${docs}`);
};

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <path>', `path to ${DEFAULT_TSCONFIG}, or the directory that contains it`, DEFAULT_TSCONFIG)
    .option('-c, --config <path>', 'path to the config file', DEFAULT_CONFIG);

const buildProgram = (io: Io, outcome: { exitCode: number }, analyzers: readonly AnalyzerRun[]): Command => {
  const program = withDocsLink(
    new Command('domain-integrity')
      .description('Check aggregate lifecycles and in-process event flows against their declared intent.')
      .version(packageVersion(), '-V, --version', 'print the version')
      .exitOverride()
      .configureOutput({ writeOut: io.out, writeErr: io.err })
      .configureHelp({ helpWidth: HELP_WIDTH })
      .addHelpText('after', EXAMPLES_FOOTER),
  );

  withCommonOptions(program.command('check').description('check the code against the config and report findings'))
    .option('--format <format>', `report format: ${alternatives(FORMATS)}`, 'text')
    .option('--baseline <path>', `baseline file whose findings count as known (default: ${DEFAULT_BASELINE}, when it exists)`)
    .option('--update-baseline', `write the current findings to the --baseline file, or to ${DEFAULT_BASELINE}`)
    .option('--show-known', 'list findings accepted by the baseline or suppressed in the config in the text output')
    .action((options: CheckOptions & CommonOptions) => {
      outcome.exitCode = checkCommand(pathsFrom(options, io), options, io, analyzers);
    });

  withCommonOptions(program.command('show').description('print Mermaid diagrams of lifecycles and event flows').argument('[name]', 'aggregate class, event, or path:Class to show; all when omitted'))
    .action((name: string | undefined, options: CommonOptions) => {
      outcome.exitCode = showCommand(pathsFrom(options, io), name, io, analyzers);
    });

  withCommonOptions(program.command('context').description('print or write the domain summary for coding agents'))
    .option('--write <file>', 'replace the marked domain-integrity section of this file, adding the section when the file has none and creating the file when missing')
    .action((options: CommonOptions & { readonly write?: string }) => {
      outcome.exitCode = contextCommand(pathsFrom(options, io), options.write, io, analyzers);
    });

  withCommonOptions(program.command('init').description('suggest and write lifecycle declarations to the config'))
    .option('-y, --yes', 'accept every suggestion without prompting')
    .option('--base-class <name>', 'discover aggregates extending or implementing this class or interface (repeatable); replaces AggregateRoot and Entity in a new config, adds to the base classes of an existing one', collect)
    .action(async (options: CommonOptions & InitOptions) => {
      outcome.exitCode = await initCommand(pathsFrom(options, io), options, io);
    });

  return program;
};

export const run = async (
  argv: readonly string[],
  io: Io,
  analyzers: readonly AnalyzerRun[] = DEFAULT_ANALYZERS,
): Promise<number> => {
  const outcome = { exitCode: 0 };
  try {
    await buildProgram(io, outcome, analyzers).parseAsync([...argv], { from: 'user' });
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
