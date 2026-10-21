import { existsSync, readFileSync } from 'node:fs';
import { UsageError } from '../engine/errors';
import { Finding, RuleId } from '../finding';
import { IDENTITY_FIELD_KINDS, IDENTITY_FIELDS, Identity, IdentityFieldKind, identityOf, serializeIdentity } from './identity';

export const BASELINE_VERSION = 2;

export type BaselineEntry = { readonly identity: Identity; readonly count: number };
export type Baseline = ReadonlyMap<string, BaselineEntry>;
export type Excess = { readonly accepted: number; readonly found: number };
export type StaleEntry = { readonly identity: Identity; readonly accepted: number; readonly found: number };
export type Partition = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly exceeded: ReadonlyMap<Finding, Excess>;
};

type EntryReading = { readonly kind: 'entry'; readonly entry: BaselineEntry } | { readonly kind: 'invalid'; readonly reason: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRuleId = (value: unknown): value is RuleId => typeof value === 'string' && Object.hasOwn(IDENTITY_FIELDS, value);

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

const KIND_CHECKS: {
  readonly [K in IdentityFieldKind]: { readonly accepts: (value: unknown) => boolean; readonly expected: string };
} = {
  string: { accepts: (value) => typeof value === 'string', expected: 'a string' },
  nullable: { accepts: (value) => typeof value === 'string' || value === null, expected: 'a string or null' },
  strings: {
    accepts: (value) => Array.isArray(value) && value.every((item) => typeof item === 'string'),
    expected: 'an array of strings',
  },
};

const invalid = (reason: string): EntryReading => ({ kind: 'invalid', reason });

const fieldKinds = (rule: RuleId): readonly (readonly [string, IdentityFieldKind])[] => {
  const kinds = IDENTITY_FIELD_KINDS[rule] as Readonly<Record<string, IdentityFieldKind>>;
  return IDENTITY_FIELDS[rule].map((field): readonly [string, IdentityFieldKind] => [field, kinds[field] as IdentityFieldKind]);
};

const canonicalValue = (kind: IdentityFieldKind, value: unknown): unknown =>
  kind === 'strings' && Array.isArray(value) ? [...(value as readonly string[])].sort() : value;

const describeVersion = (version: unknown): string => {
  if (version === undefined) return 'none';
  return typeof version === 'number' ? String(version) : JSON.stringify(version);
};

const readEntry = (value: unknown): EntryReading => {
  if (!isRecord(value)) return invalid('not an object');
  if (!('rule' in value)) return invalid('missing field "rule"');
  const rule = value.rule;
  if (!isRuleId(rule)) return invalid(`unknown rule "${String(rule)}"`);
  const kinds = fieldKinds(rule);
  const missing = kinds.find(([field]) => !(field in value));
  if (missing) return invalid(`missing field "${missing[0]}"`);
  if (!('count' in value)) return invalid('missing field "count"');
  const allowed = new Set(['rule', 'count', ...kinds.map(([field]) => field)]);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) return invalid(`unexpected field "${unexpected}"`);
  const mistyped = kinds.find(([field, kind]) => !KIND_CHECKS[kind].accepts(value[field]));
  if (mistyped) return invalid(`field "${mistyped[0]}" must be ${KIND_CHECKS[mistyped[1]].expected}`);
  const count = value.count;
  if (!isPositiveInteger(count)) return invalid('count must be a positive integer');
  const identity = Object.fromEntries([['rule', rule], ...kinds.map(([field, kind]) => [field, canonicalValue(kind, value[field])])]) as Identity;
  return { kind: 'entry', entry: { identity, count } };
};

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Cannot read baseline ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const parseJson = (path: string, content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    throw new UsageError(`Baseline ${path} is not valid JSON.`);
  }
};

const versionError = (path: string, version: unknown, toolVersion: string): UsageError =>
  version === 1
    ? new UsageError(
        `Baseline ${path} uses format version 1, which domain-integrity ${toolVersion} no longer reads. Regenerate it with check --update-baseline; that accepts every current finding, so review the report first.`,
      )
    : new UsageError(`Baseline ${path} has format version ${describeVersion(version)}; this version reads ${BASELINE_VERSION}.`);

const entriesOf = (path: string, findings: readonly unknown[]): Baseline => {
  const entries = new Map<string, BaselineEntry>();
  const indexes = new Map<string, number>();
  findings.forEach((value, index) => {
    const reading = readEntry(value);
    if (reading.kind === 'invalid') throw new UsageError(`Baseline ${path} entry ${index}: ${reading.reason}.`);
    const canonical = serializeIdentity(reading.entry.identity);
    const earlier = indexes.get(canonical);
    if (earlier !== undefined) throw new UsageError(`Baseline ${path} entry ${index} repeats entry ${earlier}.`);
    indexes.set(canonical, index);
    entries.set(canonical, reading.entry);
  });
  return entries;
};

export const parseBaseline = (path: string, content: string, toolVersion: string): Baseline => {
  const parsed = parseJson(path, content);
  if (!isRecord(parsed)) throw new UsageError(`Baseline ${path} is not a domain-integrity baseline.`);
  if (parsed.version !== BASELINE_VERSION) throw versionError(path, parsed.version, toolVersion);
  if (!Array.isArray(parsed.findings)) throw new UsageError(`Baseline ${path} is not a domain-integrity baseline.`);
  return entriesOf(path, parsed.findings);
};

export const readBaseline = (path: string, toolVersion: string): Baseline => {
  if (!existsSync(path)) throw new UsageError(`Baseline ${path} not found. Create it with --update-baseline.`);
  return parseBaseline(path, read(path), toolVersion);
};

type Group = { readonly identity: Identity; readonly findings: readonly Finding[] };

const groupsOf = (findings: readonly Finding[], repositoryRoot: string): ReadonlyMap<string, Group> => {
  const groups = new Map<string, Group>();
  findings.forEach((finding) => {
    const identity = identityOf(finding, repositoryRoot);
    const canonical = serializeIdentity(identity);
    groups.set(canonical, { identity, findings: [...(groups.get(canonical)?.findings ?? []), finding] });
  });
  return groups;
};

const byCanonical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const baselineEntries = (findings: readonly Finding[], repositoryRoot: string): readonly BaselineEntry[] =>
  [...groupsOf(findings, repositoryRoot)]
    .sort(([a], [b]) => byCanonical(a, b))
    .map(([, group]) => ({ identity: group.identity, count: group.findings.length }));

export const serializeBaseline = (findings: readonly Finding[], repositoryRoot: string): string =>
  `${JSON.stringify(
    { version: BASELINE_VERSION, findings: baselineEntries(findings, repositoryRoot).map(({ identity, count }) => ({ ...identity, count })) },
    null,
    2,
  )}\n`;

export const partitionByBaseline = (findings: readonly Finding[], baseline: Baseline, repositoryRoot: string): Partition => {
  const groups = [...groupsOf(findings, repositoryRoot)];
  const accepted = (canonical: string): number => baseline.get(canonical)?.count ?? 0;
  const knownFindings = new Set(
    groups.filter(([canonical, group]) => group.findings.length <= accepted(canonical)).flatMap(([, group]) => group.findings),
  );
  return {
    fresh: findings.filter((finding) => !knownFindings.has(finding)),
    known: findings.filter((finding) => knownFindings.has(finding)),
    exceeded: new Map(
      groups
        .filter(([canonical, group]) => accepted(canonical) > 0 && group.findings.length > accepted(canonical))
        .flatMap(([canonical, group]) =>
          group.findings.map((finding) => [finding, { accepted: accepted(canonical), found: group.findings.length }] as const),
        ),
    ),
  };
};

export const staleEntries = (findings: readonly Finding[], baseline: Baseline, repositoryRoot: string): readonly StaleEntry[] => {
  const groups = groupsOf(findings, repositoryRoot);
  return [...baseline]
    .map(([canonical, entry]) => ({ canonical, identity: entry.identity, accepted: entry.count, found: groups.get(canonical)?.findings.length ?? 0 }))
    .filter((entry) => entry.found < entry.accepted)
    .sort((a, b) => byCanonical(a.canonical, b.canonical))
    .map(({ identity, accepted, found }) => ({ identity, accepted, found }));
};
