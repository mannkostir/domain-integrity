import { toPosixRelative } from '../engine/path';
import { Finding, Problem, Severity } from '../finding';
import { findingKey } from './key';
import { Report } from './text';
import { ToolIdentity } from './tool';

export const REPORT_FORMAT_VERSION = 1;

const wireFinding = (root: string) => (finding: Finding) => ({
  ruleId: finding.ruleId,
  severity: finding.severity,
  analyzer: finding.analyzer,
  key: findingKey(finding),
  location: { file: toPosixRelative(root, finding.file), line: finding.line },
  message: finding.message,
  fix: finding.fix,
  details: finding.details,
});

const wireProblem = (problem: Problem) => ({ code: problem.code, analyzer: problem.analyzer, message: problem.message, details: problem.details });

const countOf = (findings: readonly Finding[], severity: Severity): number => findings.filter((finding) => finding.severity === severity).length;

export const formatJson = (report: Report, tool: ToolIdentity): string =>
  `${JSON.stringify(
    {
      version: REPORT_FORMAT_VERSION,
      tool: { name: tool.name, version: tool.version },
      summary: {
        errors: countOf(report.fresh, 'error'),
        warnings: countOf(report.fresh, 'warning'),
        known: report.known.length,
        problems: report.problems.length,
      },
      findings: report.fresh.map(wireFinding(report.root)),
      known: report.known.map(wireFinding(report.root)),
      problems: report.problems.map(wireProblem),
    },
    null,
    2,
  )}\n`;
