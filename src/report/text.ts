import { toPosixRelative } from '../engine/path';
import { RuleDescription } from '../analyzer';
import { Finding, Problem } from '../finding';
import { Excess, StaleEntry } from './baseline';
import { describeIdentity } from './identity';

export type AppliedBaseline = { readonly path: string; readonly stale: readonly StaleEntry[] };

export type TextOptions = { readonly showKnown: boolean };

export type Report = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly exceeded: ReadonlyMap<Finding, Excess>;
  readonly problems: readonly Problem[];
  readonly rules: readonly RuleDescription[];
  readonly repositoryRoot: string;
  readonly baseline?: AppliedBaseline;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const handledBy = (event: string, handler: string | null): string => (handler === null ? event : `${event} → ${handler}`);

const location = (finding: Finding): string => {
  switch (finding.ruleId) {
    case 'terminal-state-leak':
    case 'transition-drift':
    case 'transition-missing':
      return `${finding.details.aggregate}.${finding.details.method}()`;
    case 'unreachable-state':
    case 'outside-mutation':
      return finding.details.aggregate;
    case 'dead-handler':
    case 'handler-payload-mismatch':
      return handledBy(finding.details.event, finding.details.handler);
    case 'unhandled-event':
      return finding.details.event;
    case 'saga-missing-failure-path':
      return handledBy(finding.details.failure, finding.details.saga);
    case 'undispatched-events':
      return `${finding.details.owner}.${finding.details.buffer}`;
  }
};

const entry = (finding: Finding, root: string, suffix: string): string =>
  [
    `${finding.severity} ${finding.ruleId}  ${location(finding)}  ${toPosixRelative(root, finding.file)}:${finding.line}${suffix}`,
    `  ${finding.message}`,
    `  Fix: ${finding.fix}`,
  ].join('\n');

const excessSuffix = (excess: Excess | undefined): string =>
  excess === undefined ? '' : ` (baseline accepts ${excess.accepted} of ${excess.found})`;

const staleLine = ({ identity, accepted, found }: StaleEntry): string =>
  `  ${describeIdentity(identity)}${found === 0 ? '' : ` (accepts ${accepted}, found ${found})`}`;

const staleBlock = (stale: readonly StaleEntry[]): readonly string[] =>
  stale.length === 0
    ? []
    : [
        [
          `${stale.length} stale baseline ${stale.length === 1 ? 'entry' : 'entries'}, remove with --update-baseline:`,
          ...stale.map(staleLine),
        ].join('\n'),
      ];

export const formatText = (report: Report, options: TextOptions): string => {
  const errors = report.fresh.filter((finding) => finding.severity === 'error').length;
  const warnings = report.fresh.length - errors;
  const known = report.baseline ? `, ${report.known.length} known from baseline ${report.baseline.path}` : '';
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}${known}`;
  return `${[
    ...report.fresh.map((finding) => entry(finding, report.repositoryRoot, excessSuffix(report.exceeded.get(finding)))),
    ...(options.showKnown ? report.known.map((finding) => entry(finding, report.repositoryRoot, ' (baseline)')) : []),
    ...staleBlock(report.baseline?.stale ?? []),
    summary,
  ].join('\n\n')}\n`;
};
