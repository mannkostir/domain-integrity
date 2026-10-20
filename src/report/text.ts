import { toPosixRelative } from '../engine/path';
import { EventFlowFinding, Finding, RuleDescription } from '../analyzer';

export type AppliedBaseline = { readonly path: string; readonly stale: readonly string[] };

export type TextOptions = { readonly showKnown: boolean };

export type Report = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly problems: readonly string[];
  readonly rules: readonly RuleDescription[];
  readonly root: string;
  readonly baseline?: AppliedBaseline;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const eventFlowLocation = (finding: EventFlowFinding): string =>
  finding.checkId === 'undispatched-events'
    ? `${finding.ownerId}.${finding.buffer}`
    : `${finding.eventId}${finding.handler ? ` → ${finding.handler}` : ''}`;

const location = (finding: Finding): string =>
  finding.analyzer === 'lifecycle' ? `${finding.aggregateId}${finding.method ? `.${finding.method}()` : ''}` : eventFlowLocation(finding);

const entry = (finding: Finding, root: string, suffix: string): string =>
  [
    `${finding.severity} ${finding.checkId}  ${location(finding)}  ${toPosixRelative(root, finding.file)}:${finding.line}${suffix}`,
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
    ...report.fresh.map((finding) => entry(finding, report.root, '')),
    ...(options.showKnown ? report.known.map((finding) => entry(finding, report.root, ' (baseline)')) : []),
    ...staleBlock(report.baseline?.stale ?? []),
    summary,
  ].join('\n\n')}\n`;
};
