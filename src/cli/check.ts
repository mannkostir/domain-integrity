import { relative, resolve } from 'node:path';
import { AnalyzerRun } from '../analysis';
import { AnalyzerFailure, Finding } from '../analyzer';
import { UsageError } from '../engine/errors';
import { partitionByBaseline, readBaseline, serializeBaseline } from '../report/baseline';
import { formatJson } from '../report/json';
import { formatSarif } from '../report/sarif';
import { Report, formatText } from '../report/text';
import { guardedRead, writeText } from './files';
import { reportInternalErrors } from './internal-errors';
import { Io, Paths } from './io';
import { openSession } from './session';

export type CheckOptions = {
  readonly format: string;
  readonly baseline?: string;
  readonly updateBaseline?: boolean;
};

const FORMATTERS: Readonly<Record<string, (report: Report) => string>> = {
  text: formatText,
  json: formatJson,
  sarif: formatSarif,
};

const DEFAULT_BASELINE = 'domain-integrity.baseline.json';

const formatterFor = (format: string): ((report: Report) => string) => {
  const formatter = FORMATTERS[format];
  if (!formatter) throw new UsageError(`Unknown format "${format}". Use one of: ${Object.keys(FORMATTERS).join(', ')}.`);
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
  io.out(`Baseline written to ${relative(io.cwd, path)} with ${findings.length} findings.\n`);
  return 0;
};

export const checkCommand = (paths: Paths, options: CheckOptions, io: Io, analyzers: readonly AnalyzerRun[]): number => {
  const format = formatterFor(options.format);
  const { results } = openSession(paths, analyzers);
  const outcome: Outcome = {
    problems: results.flatMap((result) => result.problems),
    failures: results.flatMap((result) => result.failures),
    findings: results.flatMap((result) => result.findings),
  };
  outcome.problems.forEach((problem) => io.err(`problem: ${problem}\n`));
  reportInternalErrors(outcome.failures, io);
  if (options.updateBaseline) return updateBaseline(outcome, options, io);
  const baselinePath = options.baseline ? resolve(io.cwd, options.baseline) : undefined;
  const baseline = baselinePath ? guardedRead(baselinePath, () => readBaseline(baselinePath)) : new Set<string>();
  const { fresh, known } = partitionByBaseline(outcome.findings, baseline);
  io.out(format({ fresh, known, problems: outcome.problems, rules: results.flatMap((result) => result.rules), root: paths.root }));
  if (outcome.problems.length > 0 || outcome.failures.length > 0) return 2;
  return fresh.some((finding) => finding.severity === 'error') ? 1 : 0;
};
