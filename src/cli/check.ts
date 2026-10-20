import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { AnalyzerRun } from '../analysis';
import { AnalyzerFailure, Finding } from '../analyzer';
import { UsageError } from '../engine/errors';
import { baselineKeys, partitionByBaseline, readBaseline, serializeBaseline, staleEntries } from '../report/baseline';
import { formatJson } from '../report/json';
import { formatSarif } from '../report/sarif';
import { AppliedBaseline, Report, formatText } from '../report/text';
import { ToolIdentity } from '../report/tool';
import { guardedRead, writeText } from './files';
import { reportInternalErrors } from './internal-errors';
import { Io, Paths } from './io';
import { openSession } from './session';
import { toolIdentity } from './version';

export type CheckOptions = {
  readonly format: string;
  readonly baseline?: string;
  readonly updateBaseline?: boolean;
  readonly showKnown?: boolean;
};

type Formatter = (report: Report, tool: ToolIdentity) => string;

const DEFAULT_BASELINE = 'domain-integrity.baseline.json';

const formatterFor = ({ format, showKnown = false }: CheckOptions): Formatter => {
  const formatters: Readonly<Record<string, Formatter>> = {
    text: (report) => formatText(report, { showKnown }),
    json: formatJson,
    sarif: formatSarif,
  };
  const formatter = formatters[format];
  if (!formatter) throw new UsageError(`Unknown format "${format}". Use one of: ${Object.keys(formatters).join(', ')}.`);
  return formatter;
};

type Outcome = {
  readonly problems: readonly string[];
  readonly failures: readonly AnalyzerFailure[];
  readonly findings: readonly Finding[];
};

const updateBaseline = ({ problems, failures, findings }: Outcome, options: CheckOptions, io: Io): number => {
  if (problems.length > 0) {
    io.err('Baseline not written because of the problems above.\n');
    return 2;
  }
  if (failures.length > 0) {
    io.err('Baseline not written because of the internal error above.\n');
    return 2;
  }
  const path = resolve(io.cwd, options.baseline ?? DEFAULT_BASELINE);
  writeText(path, serializeBaseline(findings));
  const entries = baselineKeys(findings).length;
  io.out(`Baseline written to ${relative(io.cwd, path)} with ${entries} ${entries === 1 ? 'entry' : 'entries'}.\n`);
  return 0;
};

const baselinePathFor = (options: CheckOptions, io: Io): string | undefined => {
  if (options.baseline) return resolve(io.cwd, options.baseline);
  const fallback = resolve(io.cwd, DEFAULT_BASELINE);
  return existsSync(fallback) ? fallback : undefined;
};

const isComplete = ({ problems, failures }: Outcome): boolean => problems.length === 0 && failures.length === 0;

const appliedBaseline = (path: string, baseline: ReadonlySet<string>, outcome: Outcome, io: Io): AppliedBaseline => ({
  path: relative(io.cwd, path),
  stale: isComplete(outcome) ? staleEntries(outcome.findings, baseline) : [],
});

export const checkCommand = (paths: Paths, options: CheckOptions, io: Io, analyzers: readonly AnalyzerRun[]): number => {
  const format = formatterFor(options);
  const { results } = openSession(paths, analyzers);
  const outcome: Outcome = {
    problems: results.flatMap((result) => result.problems),
    failures: results.flatMap((result) => result.failures),
    findings: results.flatMap((result) => result.findings),
  };
  outcome.problems.forEach((problem) => io.err(`problem: ${problem}\n`));
  reportInternalErrors(outcome.failures, io);
  if (options.updateBaseline) return updateBaseline(outcome, options, io);
  const baselinePath = baselinePathFor(options, io);
  const baseline = baselinePath ? guardedRead(baselinePath, () => readBaseline(baselinePath)) : new Set<string>();
  const { fresh, known } = partitionByBaseline(outcome.findings, baseline);
  const rules = results.flatMap((result) => result.rules);
  const applied = baselinePath ? { baseline: appliedBaseline(baselinePath, baseline, outcome, io) } : {};
  io.out(format({ fresh, known, problems: outcome.problems, rules, root: paths.root, ...applied }, toolIdentity()));
  if (!isComplete(outcome)) return 2;
  return fresh.some((finding) => finding.severity === 'error') ? 1 : 0;
};
