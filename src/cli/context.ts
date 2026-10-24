import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnalyzerRun } from '../analysis';
import { SummaryOutcome } from '../analyzer';
import { toPosixRelative } from '../engine/path';
import { readText, writeText } from './files';
import { failuresAmong, reportInternalErrors } from './internal-errors';
import { Io, Paths } from './io';
import { replaceSection } from './section';
import { openSession, reportNotice } from './session';

const summaryText = (outcomes: readonly SummaryOutcome[]): string =>
  outcomes.flatMap((outcome) => (outcome.kind === 'summary' && outcome.text.length > 0 ? [outcome.text] : [])).join('\n');

const writeSummary = (summary: string, write: string, io: Io): void => {
  const target = resolve(io.cwd, write);
  const existing = existsSync(target) ? readText(io.cwd, target) : undefined;
  writeText(io.cwd, target, replaceSection(existing, summary));
  io.out(`Updated ${toPosixRelative(io.cwd, target)}.\n`);
};

export const contextCommand = (paths: Paths, write: string | undefined, io: Io, analyzers: readonly AnalyzerRun[]): number => {
  const session = openSession(paths, analyzers, io);
  reportNotice(session, io);
  const outcomes = session.results.map((result) => result.summary(paths.repositoryRoot));
  const failures = failuresAmong(outcomes);
  reportInternalErrors(failures, io);
  if (write === undefined) {
    io.out(summaryText(outcomes));
    return failures.length > 0 ? 2 : 0;
  }
  if (failures.length > 0) {
    io.err(`${write} not updated because of the internal error above.\n`);
    return 2;
  }
  writeSummary(summaryText(outcomes), write, io);
  return 0;
};
