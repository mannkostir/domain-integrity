import { runAnalyzers } from '../analysis';
import { AnalysisResult } from '../analyzer';
import { DomainDeclaration } from '../engine/declaration';
import { ProjectError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { Paths } from './io';

export type Session = { readonly results: readonly AnalysisResult[] };

export const noAggregatesMessage = (declaration: DomainDeclaration): string =>
  `No aggregates found. Searched for classes extending: ${declaration.aggregateBaseClasses.join(', ')}. Set "aggregateBaseClasses" in domain.config.ts to match your base class, for example: export default defineDomain({ aggregateBaseClasses: ['MyAggregateBase'] })`;

export const openSession = (paths: Paths): Session => {
  const project = loadProject(paths.tsconfig);
  const configFile = configSourceFile(project, paths.config);
  const declaration = readDeclaration(configFile);
  const results = runAnalyzers({ declaration, files: analysedSourceFiles(project, paths.root, configFile) });
  if (results.every((result) => result.isEmpty)) throw new ProjectError(noAggregatesMessage(declaration));
  return { results };
};
