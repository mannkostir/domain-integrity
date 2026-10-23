import { DetailsByRule, Finding, FindingOf, RuleId, RuleLevel } from '../finding';

export type RuleSuppression = {
  readonly rule: RuleId;
  readonly classId: string;
  readonly target: string;
  readonly member: string | undefined;
  readonly reason: string;
  readonly source: string;
};

export type RuleConfig = { readonly levels: ReadonlyMap<RuleId, RuleLevel>; readonly suppressions: readonly RuleSuppression[] };

export type SuppressedFinding = { readonly finding: Finding; readonly reason: string };

export type RuleOutcome = {
  readonly findings: readonly Finding[];
  readonly suppressed: readonly SuppressedFinding[];
  readonly stale: readonly RuleSuppression[];
};

type Anchor = { readonly classId: string | null; readonly member: string | undefined };

const ANCHORS: { readonly [R in RuleId]: (details: DetailsByRule[R]) => Anchor } = {
  'terminal-state-leak': (d) => ({ classId: d.aggregateId, member: d.method }),
  'unreachable-state': (d) => ({ classId: d.aggregateId, member: d.field }),
  'outside-mutation': (d) => ({ classId: d.aggregateId, member: d.field }),
  'transition-drift': (d) => ({ classId: d.aggregateId, member: d.method }),
  'transition-missing': (d) => ({ classId: d.aggregateId, member: d.method }),
  'dead-handler': (d) => ({ classId: d.handlerClassId, member: d.handlerMethod ?? undefined }),
  'handler-payload-mismatch': (d) => ({ classId: d.handlerClassId, member: d.handlerMethod ?? undefined }),
  'unhandled-event': (d) => ({ classId: d.eventId, member: undefined }),
  'saga-missing-failure-path': (d) => ({ classId: d.sagaId, member: undefined }),
  'undispatched-events': (d) => ({ classId: d.ownerId, member: d.buffer }),
};

const anchorOfRule = <R extends RuleId>(finding: FindingOf<R>): Anchor => ANCHORS[finding.ruleId](finding.details);

const anchorOf = (finding: Finding): Anchor => anchorOfRule(finding);

const matches = (suppression: RuleSuppression, finding: Finding): boolean => {
  const anchor = anchorOf(finding);
  return (
    suppression.rule === finding.ruleId &&
    anchor.classId === suppression.classId &&
    (suppression.member === undefined || suppression.member === anchor.member)
  );
};

const levelled = (finding: Finding, levels: ReadonlyMap<RuleId, RuleLevel>): readonly Finding[] => {
  const level = levels.get(finding.ruleId);
  if (level === 'off') return [];
  return [level === undefined ? finding : { ...finding, severity: level }];
};

export const applyRuleConfig = (findings: readonly Finding[], config: RuleConfig): RuleOutcome => {
  const enabled = findings.flatMap((finding) => levelled(finding, config.levels));
  const suppressionOf = (finding: Finding): RuleSuppression | undefined => config.suppressions.find((suppression) => matches(suppression, finding));
  return {
    findings: enabled.filter((finding) => suppressionOf(finding) === undefined),
    suppressed: enabled.flatMap((finding) => {
      const suppression = suppressionOf(finding);
      return suppression === undefined ? [] : [{ finding, reason: suppression.reason }];
    }),
    stale: config.suppressions.filter((suppression) => !enabled.some((finding) => matches(suppression, finding))),
  };
};

const isOff = (config: RuleConfig, ruleId: string): boolean => [...config.levels].some(([id, level]) => id === ruleId && level === 'off');

export const enabledRules = <Rule extends { readonly id: string }>(rules: readonly Rule[], config: RuleConfig): readonly Rule[] =>
  rules.filter((rule) => !isOff(config, rule.id));
