import { relative, resolve } from 'node:path';
import { UsageError } from '../engine/errors';
import { partitionByBaseline, readBaseline, serializeBaseline } from '../report/baseline';
import { formatJson } from '../report/json';
import { formatSarif } from '../report/sarif';
import { Report, formatText } from '../report/text';
import { guardedRead, writeText } from './files';
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

export const checkCommand = (paths: Paths, options: CheckOptions, io: Io): number => {
  const format = formatterFor(options.format);
  const { results } = openSession(paths);
  const problems = results.flatMap((result) => result.problems);
  const findings = results.flatMap((result) => result.findings);
  problems.forEach((problem) => io.err(`problem: ${problem}\n`));
  if (options.updateBaseline && problems.length > 0) {
    io.err('Baseline not written because of the problems above.\n');
    return 2;
  }
  if (options.updateBaseline) {
    const path = resolve(io.cwd, options.baseline ?? DEFAULT_BASELINE);
    writeText(path, serializeBaseline(findings));
    io.out(`Baseline written to ${relative(io.cwd, path)} with ${findings.length} findings.\n`);
    return 0;
  }
  const baselinePath = options.baseline ? resolve(io.cwd, options.baseline) : undefined;
  const baseline = baselinePath ? guardedRead(baselinePath, () => readBaseline(baselinePath)) : new Set<string>();
  const { fresh, known } = partitionByBaseline(findings, baseline);
  io.out(format({ fresh, known, problems, rules: results.flatMap((result) => result.rules), root: paths.root }));
  if (problems.length > 0) return 2;
  return fresh.some((finding) => finding.severity === 'error') ? 1 : 0;
};
