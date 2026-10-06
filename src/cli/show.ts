import { AmbiguousReference, DiagramOutcome } from '../analyzer';
import { UsageError } from '../engine/errors';
import { Io, Paths } from './io';
import { openSession } from './session';

const ambiguityError = ({ reference, candidates }: AmbiguousReference): UsageError =>
  new UsageError(`Aggregate name "${reference}" is ambiguous. Use one of: ${candidates.join(', ')}`);

const diagramText = (outcomes: readonly DiagramOutcome[]): string =>
  outcomes
    .flatMap((outcome) => (outcome.kind === 'diagram' && outcome.text.length > 0 ? [outcome.text] : []))
    .join('\n\n');

const firstAmbiguity = (outcomes: readonly DiagramOutcome[]): AmbiguousReference | undefined =>
  outcomes.find((outcome): outcome is AmbiguousReference => outcome.kind === 'ambiguous');

export const showCommand = (paths: Paths, aggregate: string | undefined, io: Io): number => {
  const { results } = openSession(paths);
  const outcomes = results.map((result) => result.diagram(aggregate));
  const ambiguity = firstAmbiguity(outcomes);
  if (ambiguity) throw ambiguityError(ambiguity);
  const output = diagramText(outcomes);
  if (output.length === 0) {
    throw new UsageError(
      aggregate ? `No declared aggregate named "${aggregate}".` : 'No declared aggregates to show. Run "domain-integrity init" first.',
    );
  }
  io.out(`${output}\n`);
  return 0;
};
