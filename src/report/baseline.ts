import { existsSync, readFileSync } from 'node:fs';
import { Finding, findingKey } from '../analyzer';
import { UsageError } from '../engine/errors';

type BaselineFile = { readonly findings: readonly string[] };

const isBaselineFile = (value: unknown): value is BaselineFile =>
  typeof value === 'object' &&
  value !== null &&
  'findings' in value &&
  Array.isArray(value.findings) &&
  value.findings.every((entry: unknown) => typeof entry === 'string');

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read baseline ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const parse = (path: string): unknown => {
  const content = read(path);
  try {
    return JSON.parse(content);
  } catch {
    throw new UsageError(`Baseline ${path} is not valid JSON.`);
  }
};

export const baselineKeys = (findings: readonly Finding[]): readonly string[] => [...new Set(findings.map(findingKey))].sort();

export const staleEntries = (findings: readonly Finding[], baseline: ReadonlySet<string>): readonly string[] => {
  const current = new Set(findings.map(findingKey));
  return [...baseline].filter((key) => !current.has(key)).sort();
};

export const serializeBaseline = (findings: readonly Finding[]): string =>
  `${JSON.stringify({ version: 1, findings: baselineKeys(findings) }, null, 2)}\n`;

export const readBaseline = (path: string): ReadonlySet<string> => {
  if (!existsSync(path)) throw new UsageError(`Baseline ${path} not found. Create it with --update-baseline.`);
  const parsed = parse(path);
  if (!isBaselineFile(parsed)) throw new UsageError(`Baseline ${path} is not a domain-integrity baseline.`);
  return new Set(parsed.findings);
};

export const partitionByBaseline = (
  findings: readonly Finding[],
  baseline: ReadonlySet<string>,
): { fresh: Finding[]; known: Finding[] } => ({
  fresh: findings.filter((finding) => !baseline.has(findingKey(finding))),
  known: findings.filter((finding) => baseline.has(findingKey(finding))),
});
