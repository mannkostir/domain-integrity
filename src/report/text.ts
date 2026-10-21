import { toPosixRelative } from '../engine/path';
import { RuleDescription } from '../analyzer';
import { Finding, Problem } from '../finding';

export type AppliedBaseline = { readonly path: string; readonly stale: readonly string[] };

export type TextOptions = { readonly showKnown: boolean };

export type Report = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly problems: readonly Problem[];
  readonly rules: readonly RuleDescription[];
  readonly repositoryRoot: string;
  readonly baseline?: AppliedBaseline;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const handledBy = (eventId: string, handler: string | null): string => (handler === null ? eventId : `${eventId} → ${handler}`);

const location = (finding: Finding): string => {
  switch (finding.ruleId) {
    case 'terminal-state-leak':
    case 'transition-drift':
    case 'transition-missing':
      return `${finding.details.aggregateId}.${finding.details.method}()`;
    case 'unreachable-state':
    case 'outside-mutation':
      return finding.details.aggregateId;
    case 'dead-handler':
    case 'handler-payload-mismatch':
      return handledBy(finding.details.eventId, finding.details.handler);
    case 'unhandled-event':
      return finding.details.eventId;
    case 'saga-missing-failure-path':
      return handledBy(finding.details.failureId, finding.details.sagaId);
    case 'undispatched-events':
      return `${finding.details.ownerId}.${finding.details.buffer}`;
  }
};

const entry = (finding: Finding, root: string, suffix: string): string =>
  [
    `${finding.severity} ${finding.ruleId}  ${location(finding)}  ${toPosixRelative(root, finding.file)}:${finding.line}${suffix}`,
    `  ${finding.message}`,
    `  Fix: ${finding.fix}`,
  ].join('\n');

const staleBlock = (stale: readonly string[]): readonly string[] =>
  stale.length === 0
    ? []
    : [
        [
          `${stale.length} stale baseline ${stale.length === 1 ? 'entry' : 'entries'}, remove with --update-baseline:`,
          ...stale.map((key) => `  ${key}`),
        ].join('\n'),
      ];

export const formatText = (report: Report, options: TextOptions): string => {
  const errors = report.fresh.filter((finding) => finding.severity === 'error').length;
  const warnings = report.fresh.length - errors;
  const known = report.baseline ? `, ${report.known.length} known from baseline ${report.baseline.path}` : '';
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}${known}`;
  return `${[
    ...report.fresh.map((finding) => entry(finding, report.repositoryRoot, '')),
    ...(options.showKnown ? report.known.map((finding) => entry(finding, report.repositoryRoot, ' (baseline)')) : []),
    ...staleBlock(report.baseline?.stale ?? []),
    summary,
  ].join('\n\n')}\n`;
};
