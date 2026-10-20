import { AnalyzerRun } from '../analysis';
import { AmbiguousReference, DiagramOutcome } from '../analyzer';
import { UsageError } from '../engine/errors';
import { failuresAmong, reportInternalErrors } from './internal-errors';
import { Io, Paths } from './io';
import { openSession, reportNotice } from './session';

const ambiguityError = ({ reference, candidates }: AmbiguousReference): UsageError =>
  new UsageError(`Name "${reference}" is ambiguous. Use one of: ${candidates.join(', ')}`);

const diagramText = (outcomes: readonly DiagramOutcome[]): string =>
  outcomes
    .flatMap((outcome) => (outcome.kind === 'diagram' && outcome.text.length > 0 ? [outcome.text] : []))
    .join('\n\n');

const firstAmbiguity = (outcomes: readonly DiagramOutcome[]): AmbiguousReference | undefined =>
  outcomes.find((outcome): outcome is AmbiguousReference => outcome.kind === 'ambiguous');

const nothingToShowError = (aggregate: string | undefined): UsageError =>
  new UsageError(
    aggregate
      ? `No declared aggregate or event named "${aggregate}".`
      : 'No declared aggregates or event flows to show. Run "domain-integrity init" first.',
  );

export const showCommand = (paths: Paths, aggregate: string | undefined, io: Io, analyzers: readonly AnalyzerRun[]): number => {
  const session = openSession(paths, analyzers);
  reportNotice(session, io);
  if (session.kind === 'nothing-declared') return 0;
  const outcomes = session.results.map((result) => result.diagram(aggregate));
  const failures = failuresAmong(outcomes);
  reportInternalErrors(failures, io);
  const ambiguity = firstAmbiguity(outcomes);
  if (ambiguity) throw ambiguityError(ambiguity);
  const output = diagramText(outcomes);
  if (output.length === 0 && failures.length === 0) throw nothingToShowError(aggregate);
  if (output.length > 0) io.out(`${output}\n`);
  return failures.length > 0 ? 2 : 0;
};
