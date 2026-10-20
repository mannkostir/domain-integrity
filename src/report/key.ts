import { DetailsByRule, Finding, FindingOf, RuleId } from '../finding';

const KEY_TUPLES: { readonly [R in RuleId]: (details: DetailsByRule[R]) => readonly string[] } = {
  'terminal-state-leak': (details) => [details.aggregateId, details.method, details.field, details.values.join(',')],
  'unreachable-state': (details) => [details.aggregateId, '', details.field, details.value],
  'outside-mutation': (details) => [details.aggregateId, '', details.field, details.scope],
  'transition-drift': (details) => [details.aggregateId, details.method, details.field, details.kind],
  'transition-missing': (details) => [details.aggregateId, details.method, details.field, 'missing'],
  'dead-handler': (details) => [details.eventId, details.handler ?? '', ''],
  'handler-payload-mismatch': (details) => [details.eventId, details.handler ?? '', details.declaredIds.join(',')],
  'unhandled-event': (details) => [details.eventId, '', ''],
  'saga-missing-failure-path': (details) => [details.failureId, details.sagaId, details.successId],
  'undispatched-events': (details) => [details.ownerId, details.buffer, ''],
};

const keyTuple = <R extends RuleId>(finding: FindingOf<R>): readonly string[] => KEY_TUPLES[finding.ruleId](finding.details);

export const findingKey = (finding: Finding): string => [finding.ruleId, ...keyTuple(finding)].join('|');
