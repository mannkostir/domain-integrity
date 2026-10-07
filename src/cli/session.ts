import { runAnalyzers } from '../analysis';
import { AnalysisResult } from '../analyzer';
import { DomainDeclaration } from '../engine/declaration';
import { ProjectError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { Paths } from './io';

export type Session = { readonly results: readonly AnalysisResult[] };

export const noAggregatesMessage = (declaration: DomainDeclaration): string =>
  `No aggregates found. Searched for classes extending or implementing: ${declaration.aggregateBaseClasses.join(', ')}. Set "aggregateBaseClasses" in domain.config.ts to the base class or interface your aggregates extend or implement, for example: export default defineDomain({ aggregateBaseClasses: ['MyAggregateBase'] })`;

export const nothingToAnalyseMessage = (declaration: DomainDeclaration): string =>
  `${noAggregatesMessage(declaration)} No event handlers were found either. Recognised handlers use the decorators ${declaration.events.handlerDecorators.join(', ')} (set "events.handlerDecorators" for your own), the methods ${declaration.events.registerMethods.join(', ')} (set "events.registerMethods"), subscribedTo(), or @Saga() with ofType().`;

export const openSession = (paths: Paths): Session => {
  const project = loadProject(paths.tsconfig);
  const configFile = configSourceFile(project, paths.config);
  const declaration = readDeclaration(configFile);
  const results = runAnalyzers({ declaration, files: analysedSourceFiles(project, paths.root, configFile), root: paths.root, configFile });
  if (results.every((result) => result.isEmpty)) throw new ProjectError(nothingToAnalyseMessage(declaration));
  return { results };
};
