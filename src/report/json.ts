import { toPosixRelative } from './path';
import { Finding } from '../analyzer';
import { Report } from './text';

const relativeTo = (root: string) => (finding: Finding): Finding => ({ ...finding, file: toPosixRelative(root, finding.file) });

export const formatJson = (report: Report): string =>
  `${JSON.stringify(
    {
      findings: report.fresh.map(relativeTo(report.root)),
      known: report.known.map(relativeTo(report.root)),
      problems: report.problems,
    },
    null,
    2,
  )}\n`;
