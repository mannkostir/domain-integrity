import { relative } from 'node:path';
import { lifecycleAnalyzer } from '../analyzers/lifecycle/analyzer';
import { LifecycleSuggestion } from '../analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../engine/declaration';
import { ProjectError, UsageError } from '../engine/errors';
import { analysedSourceFiles, configSourceFile, loadProject } from '../engine/project';
import { readDeclaration } from '../engine/read-config';
import { writeSuggestions } from './config-writer';
import { Io, Paths } from './io';
import { noAggregatesMessage } from './session';

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

export const initCommand = async (paths: Paths, options: { readonly yes?: boolean }, io: Io): Promise<number> => {
  if (!options.yes && !io.isInteractive) {
    throw new UsageError('init needs an interactive terminal to confirm suggestions; pass --yes to accept them all.');
  }
  const project = loadProject(paths.tsconfig);
  const existing = project.getFileSystem().fileExistsSync(paths.config) ? configSourceFile(project, paths.config) : undefined;
  const declaration = existing ? readDeclaration(existing) : DEFAULT_DECLARATION;
  const model = lifecycleAnalyzer.extract({ declaration, files: analysedSourceFiles(project, paths.root, existing) });
  if (lifecycleAnalyzer.isEmpty(model)) throw new ProjectError(noAggregatesMessage(declaration));
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
    await writeSuggestions(project, paths.config, accepted).save();
  } catch (error) {
    throw new UsageError(`Cannot write ${paths.config}: ${error instanceof Error ? error.message : String(error)}`);
  }
  io.out(
    `Declared ${accepted.length} aggregate${accepted.length === 1 ? '' : 's'} in ${relative(io.cwd, paths.config)}. Review the terminal states, then run "domain-integrity check".\n`,
  );
  return 0;
};
