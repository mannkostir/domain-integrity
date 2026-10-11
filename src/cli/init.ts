import { relative } from 'node:path';
import { Project, SourceFile } from 'ts-morph';
import { lifecycleAnalyzer } from '../analyzers/lifecycle/analyzer';
import { LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../engine/declaration';
import { ProjectError, UsageError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { addLifecycles, openConfig, recordBaseClasses } from './config-writer';
import { initRetryCommand, noAggregatesForInitMessage } from './init-retry';
import { Io, Paths } from './io';
import { moduleSpecifiers } from './module-specifier';

const describeSuggestion = (suggestion: LifecycleSuggestion, root: string): string => {
  const fields = suggestion.fields
    .map((field) => `${field.field.name} [terminal: ${field.terminal.map((value) => value.label).join(', ') || 'none'}]`)
    .join('; ');
  return `${suggestion.className} (${relative(root, suggestion.file)}): ${fields}. Declare? [Y/n] `;
};

const confirmEach = (suggestions: readonly LifecycleSuggestion[], io: Io, root: string): Promise<readonly LifecycleSuggestion[]> =>
  suggestions.reduce<Promise<readonly LifecycleSuggestion[]>>(async (accepted, suggestion) => {
    const previous = await accepted;
    return (await io.prompt(describeSuggestion(suggestion, root))) ? [...previous, suggestion] : previous;
  }, Promise.resolve([]));

export type InitOptions = { readonly yes?: boolean; readonly baseClass?: readonly string[] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const assertIdentifiers = (names: readonly string[]): void => {
  const invalid = names.find((name) => !IDENTIFIER.test(name));
  if (invalid !== undefined) {
    throw new UsageError(`--base-class "${invalid}" is not a valid class or interface name.`);
  }
};

const existingConfig = (project: Project, configPath: string): SourceFile | undefined =>
  project.getFileSystem().fileExistsSync(configPath) ? configSourceFile(project, configPath) : undefined;

const validated = (config: SourceFile | undefined): SourceFile | undefined => {
  if (config !== undefined) readDeclaration(config);
  return config;
};

const configWithBaseClasses = (project: Project, configPath: string, names: readonly string[]): SourceFile => {
  const config = validated(existingConfig(project, configPath)) ?? openConfig(project, configPath);
  recordBaseClasses(config, names);
  return config;
};

const startingConfig = (project: Project, configPath: string, baseClasses: readonly string[] | undefined): SourceFile | undefined =>
  baseClasses === undefined ? existingConfig(project, configPath) : configWithBaseClasses(project, configPath, baseClasses);

const writeLifecycles = async (
  project: Project,
  config: SourceFile,
  accepted: readonly LifecycleSuggestion[],
): Promise<void> => {
  addLifecycles(config, moduleSpecifiers(project), accepted);
  await config.save();
};

export const initCommand = async (paths: Paths, options: InitOptions, io: Io): Promise<number> => {
  assertIdentifiers(options.baseClass ?? []);
  if (!options.yes && !io.isInteractive) {
    throw new UsageError('init needs an interactive terminal to confirm suggestions; pass --yes to accept them all.');
  }
  const project = loadProject(paths.tsconfig);
  const config = startingConfig(project, paths.config, options.baseClass);
  const declaration = config ? readDeclaration(config) : DEFAULT_DECLARATION;
  const model = lifecycleAnalyzer.extract({ declaration, files: analysedSourceFiles(project, paths.root, config), root: paths.root, configFile: config });
  if (lifecycleAnalyzer.isEmpty(model)) {
    throw new ProjectError(noAggregatesForInitMessage(declaration, initRetryCommand(paths, io.cwd, options.yes === true)));
  }
  const suggestions = lifecycleAnalyzer.suggest(model);
  if (suggestions.length === 0) {
    const allDeclared = model.aggregates.every((aggregate) => aggregate.declared);
    io.out(
      allDeclared
        ? 'All discovered aggregates are already declared.\n'
        : 'No state fields found in the discovered aggregates; nothing to declare.\n',
    );
    return 0;
  }
  const accepted = options.yes ? suggestions : await confirmEach(suggestions, io, paths.root);
  if (accepted.length === 0) {
    io.out('Nothing declared.\n');
    return 0;
  }
  try {
    await writeLifecycles(project, config ?? openConfig(project, paths.config), accepted);
  } catch (error) {
    throw new UsageError(`Cannot write ${paths.config}: ${error instanceof Error ? error.message : String(error)}`);
  }
  io.out(
    `Declared ${accepted.length} aggregate${accepted.length === 1 ? '' : 's'} in ${relative(io.cwd, paths.config)}. Review the terminal states, then run "domain-integrity check".\n`,
  );
  return 0;
};
