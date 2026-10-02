import { toPosixRelative } from './path';
import { Finding, RuleDescription } from '../analyzer';

export type Report = {
  readonly fresh: readonly Finding[];
  readonly known: readonly Finding[];
  readonly problems: readonly string[];
  readonly rules: readonly RuleDescription[];
  readonly root: string;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const entry = (finding: Finding, root: string, suffix: string): string =>
  [
    `${finding.severity} ${finding.checkId}  ${finding.aggregate}${finding.method ? `.${finding.method}()` : ''}  ${toPosixRelative(root, finding.file)}:${finding.line}${suffix}`,
    `  ${finding.message}`,
    `  Fix: ${finding.fix}`,
  ].join('\n');

export const formatText = (report: Report): string => {
  const errors = report.fresh.filter((finding) => finding.severity === 'error').length;
  const warnings = report.fresh.length - errors;
  const known = report.known.length > 0 ? `, ${report.known.length} known from baseline` : '';
  const summary = `${plural(errors, 'error')}, ${plural(warnings, 'warning')}${known}`;
  return `${[
    ...report.fresh.map((finding) => entry(finding, report.root, '')),
    ...report.known.map((finding) => entry(finding, report.root, ' (baseline)')),
    summary,
  ].join('\n\n')}\n`;
};
