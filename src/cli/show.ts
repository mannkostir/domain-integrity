import { DiagramOutcome } from '../analyzer';
import { UsageError } from '../engine/errors';
import { Io, Paths } from './io';
import { openSession } from './session';

const ambiguityError = (aggregate: string, candidates: readonly string[]): UsageError =>
  new UsageError(`Aggregate name "${aggregate}" is ambiguous. Use one of: ${candidates.join(', ')}`);

const diagramText = (outcomes: readonly DiagramOutcome[]): string =>
  outcomes
    .flatMap((outcome) => (outcome.kind === 'diagram' && outcome.text.length > 0 ? [outcome.text] : []))
    .join('\n\n');

const ambiguousCandidates = (outcomes: readonly DiagramOutcome[]): readonly string[] =>
  outcomes.flatMap((outcome) => (outcome.kind === 'ambiguous' ? outcome.candidates : []));

export const showCommand = (paths: Paths, aggregate: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const outcomes = results.map((result) => result.diagram(aggregate));
  const candidates = ambiguousCandidates(outcomes);
  if (aggregate !== undefined && candidates.length > 0) throw ambiguityError(aggregate, candidates);
  const output = diagramText(outcomes);
  if (output.length === 0) {
    throw new UsageError(
      aggregate ? `No declared aggregate named "${aggregate}".` : 'No declared aggregates to show. Run "domain-integrity init" first.',
    );
  }
  io.out(`${output}\n`);
  return 0;
};
