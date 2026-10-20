import { toPosixRelative } from '../engine/path';
import { DetailsByProblem, DetailsByRule, Finding, FindingOf, Problem, ProblemCode, ProblemOf, RuleId, Severity } from '../finding';
import { findingKey } from './key';
import { Report } from './text';
import { ToolIdentity } from './tool';

export const REPORT_FORMAT_VERSION = 1;

const FINDING_DETAILS: { readonly [R in RuleId]: (details: DetailsByRule[R]) => object } = {
  'terminal-state-leak': (d) => ({ aggregate: d.aggregate, aggregateId: d.aggregateId, method: d.method, field: d.field, values: [...d.values] }),
  'unreachable-state': (d) => ({ aggregate: d.aggregate, aggregateId: d.aggregateId, field: d.field, value: d.value }),
  'outside-mutation': (d) => ({ aggregate: d.aggregate, aggregateId: d.aggregateId, field: d.field, scope: d.scope }),
  'transition-drift': (d) => ({ aggregate: d.aggregate, aggregateId: d.aggregateId, method: d.method, field: d.field, kind: d.kind, values: [...d.values] }),
  'transition-missing': (d) => ({ aggregate: d.aggregate, aggregateId: d.aggregateId, method: d.method, field: d.field, values: [...d.values] }),
  'dead-handler': (d) => ({ event: d.event, eventId: d.eventId, handler: d.handler }),
  'handler-payload-mismatch': (d) => ({ event: d.event, eventId: d.eventId, handler: d.handler, declared: [...d.declared], declaredIds: [...d.declaredIds] }),
  'unhandled-event': (d) => ({ event: d.event, eventId: d.eventId }),
  'saga-missing-failure-path': (d) => ({ saga: d.saga, sagaId: d.sagaId, success: d.success, successId: d.successId, failure: d.failure, failureId: d.failureId }),
  'undispatched-events': (d) => ({ owner: d.owner, ownerId: d.ownerId, buffer: d.buffer, method: d.method, raisers: [...d.raisers] }),
};

const PROBLEM_DETAILS: { readonly [C in ProblemCode]: (details: DetailsByProblem[C]) => object } = {
  'state-field-accessor': (d) => ({ aggregate: d.aggregate, field: d.field }),
  'state-field-missing': (d) => ({ aggregate: d.aggregate, field: d.field }),
  'state-field-unsupported-type': (d) => ({ aggregate: d.aggregate, field: d.field, type: d.type }),
  'unknown-state-value': (d) => ({ aggregate: d.aggregate, field: d.field, value: d.value, known: [...d.known] }),
  'transition-method-missing': (d) => ({ aggregate: d.aggregate, method: d.method }),
  'event-not-analysed': (d) => ({ event: d.event }),
  'saga-outcome-unhandled': (d) => ({ saga: d.saga, success: d.success, failure: d.failure }),
};

const findingDetails = <R extends RuleId>(finding: FindingOf<R>): object => FINDING_DETAILS[finding.ruleId](finding.details);

const problemDetails = <C extends ProblemCode>(problem: ProblemOf<C>): object => PROBLEM_DETAILS[problem.code](problem.details);

const wireFinding = (root: string) => (finding: Finding) => ({
  ruleId: finding.ruleId,
  severity: finding.severity,
  analyzer: finding.analyzer,
  key: findingKey(finding),
  location: { file: toPosixRelative(root, finding.file), line: finding.line },
  message: finding.message,
  fix: finding.fix,
  details: findingDetails(finding),
});

const wireProblem = (problem: Problem) => ({ code: problem.code, analyzer: problem.analyzer, message: problem.message, details: problemDetails(problem) });

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
