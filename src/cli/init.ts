import { Project, SourceFile } from 'ts-morph';
import { lifecycleAnalyzer } from '../analyzers/lifecycle/analyzer';
import { LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION, DomainDeclaration } from '../engine/declaration';
import { ProjectError, UsageError } from '../engine/errors';
import { fileErrorReason } from '../engine/file-error';
import { isIdentifierText } from '../engine/identifier';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { addLifecycles, openConfig, recordBaseClasses } from './config-writer';
import { reportDeprecations } from './deprecations';
import { guardedRead } from './files';
import { reviewSuggestions } from './init-prompt';
import { initRetryCommand, noAggregatesForInitMessage } from './init-retry';
import { Io, Paths } from './io';
import { moduleSpecifiers } from './module-specifier';
import { toPosixRelative } from '../engine/path';

export type InitOptions = { readonly yes?: boolean; readonly baseClass?: readonly string[] };

const assertIdentifiers = (names: readonly string[]): void => {
  const invalid = names.find((name) => !isIdentifierText(name));
  if (invalid !== undefined) {
    throw new UsageError(`--base-class "${invalid}" is not a valid class or interface name.`);
  }
};

type ConfigLocation = { readonly path: string; readonly name: string; readonly cwd: string };

const existingConfig = (project: Project, location: ConfigLocation): SourceFile | undefined =>
  project.getFileSystem().fileExistsSync(location.path)
    ? guardedRead(location.cwd, location.path, () => configSourceFile(project, location.path, location.cwd))
    : undefined;

const openedConfig = (project: Project, location: ConfigLocation): SourceFile =>
  guardedRead(location.cwd, location.path, () => openConfig(project, location.path));

const configWithBaseClasses = (project: Project, location: ConfigLocation, existing: SourceFile | undefined, names: readonly string[]): SourceFile => {
  const config = existing ?? openedConfig(project, location);
  recordBaseClasses(config, location.name, names, existing === undefined ? [] : DEFAULT_DECLARATION.aggregateBaseClasses);
  return config;
};

const startingConfig = (project: Project, location: ConfigLocation, existing: SourceFile | undefined, baseClasses: readonly string[] | undefined): SourceFile | undefined =>
  baseClasses === undefined ? existing : configWithBaseClasses(project, location, existing, baseClasses);

const saveConfig = async (config: SourceFile, location: ConfigLocation): Promise<void> => {
  try {
    await config.save();
  } catch (error) {
    throw new UsageError(`Cannot write ${location.name}: ${fileErrorReason(location.cwd, location.path, error)}`);
  }
};

const writeLifecycles = async (
  project: Project,
  config: SourceFile,
  location: ConfigLocation,
  accepted: readonly LifecycleSuggestion[],
): Promise<void> => {
  addLifecycles(config, location.name, moduleSpecifiers(project), accepted);
  await saveConfig(config, location);
};

const unsavedBaseClassesNote = (configPath: string, baseClasses: readonly string[]): string =>
  `No config was written to ${configPath}, so the --base-class names were not saved. For check to find the same aggregates, add aggregates: { baseClasses: [${baseClasses.map((name) => `'${name}'`).join(', ')}] } to defineDomain({...}) in ${configPath} yourself.\n`;

const nothingWrittenMessage = (reason: string, options: InitOptions, configPath: string, declaration: DomainDeclaration): string =>
  options.baseClass === undefined
    ? `${reason}\n`
    : `${reason}\n${unsavedBaseClassesNote(configPath, declaration.aggregateBaseClasses)}`;

export const initCommand = async (paths: Paths, options: InitOptions, io: Io): Promise<number> => {
  assertIdentifiers(options.baseClass ?? []);
  const project = loadProject(paths.tsconfig, paths.config, io.cwd);
  const configName = toPosixRelative(io.cwd, paths.config);
  const location: ConfigLocation = { path: paths.config, name: configName, cwd: io.cwd };
  const existing = existingConfig(project, location);
  if (existing !== undefined) reportDeprecations(readDeclaration(existing, configName).deprecations, configName, io);
  const config = startingConfig(project, location, existing, options.baseClass);
  const declaration = config ? readDeclaration(config, configName).declaration : DEFAULT_DECLARATION;
  const model = lifecycleAnalyzer.extract({ declaration, files: analysedSourceFiles(project, config), projectRoot: paths.projectRoot, repositoryRoot: paths.repositoryRoot, configFile: config });
  if (lifecycleAnalyzer.scope(model) === 'nothing-found') {
    throw new ProjectError(noAggregatesForInitMessage(declaration, initRetryCommand(paths, io.cwd, options.yes === true)));
  }
  const suggestions = lifecycleAnalyzer.suggest(model);
  if (suggestions.length === 0) {
    const allDeclared = model.aggregates.every((aggregate) => aggregate.declared);
    io.out(
      nothingWrittenMessage(
        allDeclared
          ? 'All discovered aggregates are already declared.'
          : 'No state fields found in the discovered aggregates; nothing to declare.',
        options,
        configName,
        declaration,
      ),
    );
    return 0;
  }
  if (!options.yes && !io.isInteractive) {
    throw new UsageError('init needs an interactive terminal to confirm suggestions; pass --yes to accept them all.');
  }
  const accepted = options.yes ? suggestions : await reviewSuggestions(suggestions, io, paths.repositoryRoot);
  if (accepted.length === 0) {
    io.out(nothingWrittenMessage('Nothing declared.', options, configName, declaration));
    return 0;
  }
  await writeLifecycles(project, config ?? openedConfig(project, location), location, accepted);
  io.out(
    `Declared ${accepted.length} aggregate${accepted.length === 1 ? '' : 's'} in ${configName}. Review the terminal states, then run "domain-integrity check".\n`,
  );
  return 0;
};
