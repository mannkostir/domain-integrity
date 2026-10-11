import { AnalyzerFailure, DiagramOutcome, SummaryOutcome } from '../analyzer';
import { Io } from './io';
import { packageVersion } from './version';

const TRACE_FRAMES = 5;

const isFrame = (line: string): boolean => line.trimStart().startsWith('at ');

const describe = (value: unknown): string => {
  try {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
};

const traceOf = (error: unknown): string => {
  if (!(error instanceof Error)) return describe(error);
  const lines = (error.stack ?? `${error.name}: ${error.message}`).split('\n');
  const firstFrame = lines.findIndex(isFrame);
  return lines.slice(0, (firstFrame < 0 ? lines.length : firstFrame) + TRACE_FRAMES).join('\n');
};

const reportOf = (failure: AnalyzerFailure): string =>
  `internal error in ${failure.analyzer}, please report (domain-integrity ${packageVersion()})\n${traceOf(failure.error)}\n`;

const isFailure = (outcome: DiagramOutcome | SummaryOutcome): outcome is AnalyzerFailure => outcome.kind === 'failed';

export const failuresAmong = (outcomes: readonly (DiagramOutcome | SummaryOutcome)[]): readonly AnalyzerFailure[] =>
  outcomes.filter(isFailure);

export const reportInternalErrors = (failures: readonly AnalyzerFailure[], io: Io): void =>
  failures.forEach((failure) => io.err(reportOf(failure)));
