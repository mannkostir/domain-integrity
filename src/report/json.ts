import { toPosixRelative } from '../engine/path';
import { Finding } from '../finding';
import { Report } from './text';
import { ToolIdentity } from './tool';

const relativeTo = (root: string) => (finding: Finding): Finding => ({ ...finding, file: toPosixRelative(root, finding.file) });

export const formatJson = (report: Report, tool: ToolIdentity): string =>
  `${JSON.stringify(
    {
      tool: { name: tool.name, version: tool.version },
      findings: report.fresh.map(relativeTo(report.root)),
      known: report.known.map(relativeTo(report.root)),
      problems: report.problems,
    },
    null,
    2,
  )}\n`;
