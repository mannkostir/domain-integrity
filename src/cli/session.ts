import { AnalyzerRun, runAnalyzers } from '../analysis';
import { AnalysisResult, CheckScope } from '../analyzer';
import { DomainDeclaration } from '../engine/declaration';
import { Problem } from '../finding';
import { ProjectError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject, loadedSourceFiles } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { toPosixRelative } from '../engine/path';
import { reportDeprecations } from './deprecations';
import { Io, Paths } from './io';

export type Session =
  | { readonly kind: 'checkable'; readonly declaration: DomainDeclaration; readonly results: readonly AnalysisResult[] }
  | { readonly kind: 'nothing-declared'; readonly declaration: DomainDeclaration; readonly results: readonly AnalysisResult[]; readonly notice: string };

const NO_AGGREGATES = 'No aggregates found.';

const searchedBaseClasses = (declaration: DomainDeclaration): string =>
  `Searched for classes extending or implementing: ${declaration.aggregateBaseClasses.join(', ')}.`;

const setBaseClasses = (config: string): string =>
  `Set "aggregates.baseClasses" in ${config} to the base class or interface your aggregates extend or implement, for example: export default defineDomain({ aggregates: { baseClasses: ['MyAggregateBase'] } })`;

const NO_HANDLERS = 'No event handlers were found either.';

const recognisedHandlers = (declaration: DomainDeclaration): string =>
  `Recognised handlers use the decorators ${declaration.events.handlerDecorators.join(', ')} (set "events.handlerDecorators" for your own), the methods ${declaration.events.registerMethods.join(', ')} (set "events.registerMethods"), subscribedTo(), or @Saga() with ofType().`;

export const noAggregatesFound = (declaration: DomainDeclaration): string => `${NO_AGGREGATES} ${searchedBaseClasses(declaration)}`;

const nothingFoundMessage = (config: string, declaration: DomainDeclaration, fileCount: number, problems: readonly Problem[]): string =>
  [
    loadedSourceFiles(fileCount),
    ...problems.map((problem) => `problem: ${problem.message}`),
    NO_AGGREGATES,
    searchedBaseClasses(declaration),
    setBaseClasses(config),
    NO_HANDLERS,
    recognisedHandlers(declaration),
  ].join('\n');

const nothingDeclaredNotice = (config: string, fileCount: number): string =>
  [
    loadedSourceFiles(fileCount),
    `Nothing to check: ${config} declares no lifecycles, and no event handlers or event flows were found.`,
    'Run "domain-integrity init" to declare the lifecycles of the aggregates it finds.',
  ].join('\n');

export const runScope = (scopes: readonly CheckScope[]): CheckScope => {
  if (scopes.includes('checkable')) return 'checkable';
  return scopes.includes('nothing-declared') ? 'nothing-declared' : 'nothing-found';
};

export const openSession = (paths: Paths, analyzers: readonly AnalyzerRun[], io: Io): Session => {
  const project = loadProject(paths.tsconfig, paths.config, io.cwd);
  const configFile = configSourceFile(project, paths.config, io.cwd);
  const config = toPosixRelative(io.cwd, paths.config);
  const { declaration, deprecations } = readDeclaration(configFile, config);
  reportDeprecations(deprecations, config, io);
  const files = analysedSourceFiles(project, configFile);
  const results = runAnalyzers({ declaration, files, projectRoot: paths.projectRoot, repositoryRoot: paths.repositoryRoot, configFile }, analyzers);
  const scope = runScope(results.map((result) => result.scope));
  if (scope === 'nothing-found') throw new ProjectError(nothingFoundMessage(config, declaration, files.length, results.flatMap((result) => result.problems)));
  if (scope === 'nothing-declared') return { kind: 'nothing-declared', declaration, results, notice: nothingDeclaredNotice(config, files.length) };
  return { kind: 'checkable', declaration, results };
};

export const reportNotice = (session: Session, io: Io): void => {
  if (session.kind === 'nothing-declared') io.err(`${session.notice}\n`);
};
