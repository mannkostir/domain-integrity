import { describe, expect, it } from 'vitest';
import { RuleConfig, RuleSuppression, applyRuleConfig, enabledRules } from '../../src/rules/apply';
import { RuleDescription } from '../../src/analyzer';
import { Finding } from '../../src/finding';
import { bufferFinding, driftFinding, finding, flowFinding, mismatchFinding, missingFinding, mutationFinding, sagaFinding, unhandledFinding, unreachableFinding } from '../helpers/model';

const suppression = (overrides: Partial<RuleSuppression>): RuleSuppression => ({
  rule: 'terminal-state-leak',
  classId: 'Order',
  target: 'Order',
  member: 'annotate',
  reason: 'R',
  source: 'domain.config.ts:7',
  ...overrides,
});

const config = (overrides: Partial<RuleConfig>): RuleConfig => ({ levels: new Map(), suppressions: [], ...overrides });

describe('applyRuleConfig', () => {
  it('keeps findings when nothing is configured', () => {
    expect(applyRuleConfig([finding()], config({})).findings).toEqual([finding()]);
  });

  it('drops findings of a rule that is off', () => {
    expect(applyRuleConfig([finding()], config({ levels: new Map([['terminal-state-leak', 'off']]) })).findings).toEqual([]);
  });

  it('lowers an error rule to a warning', () => {
    const [levelled] = applyRuleConfig([finding()], config({ levels: new Map([['terminal-state-leak', 'warning']]) })).findings;

    expect(levelled?.severity).toBe('warning');
  });

  it('raises a warning rule to an error', () => {
    const [levelled] = applyRuleConfig([missingFinding()], config({ levels: new Map([['transition-missing', 'error']]) })).findings;

    expect(levelled?.severity).toBe('error');
  });

  it('moves a matching finding to suppressed with its reason', () => {
    const outcome = applyRuleConfig([finding()], config({ suppressions: [suppression({ reason: 'Known.' })] }));

    expect({ findings: outcome.findings, suppressed: outcome.suppressed }).toEqual({ findings: [], suppressed: [{ finding: finding(), reason: 'Known.' }] });
  });

  it('suppresses every member of the class when no member is given', () => {
    expect(applyRuleConfig([finding()], config({ suppressions: [suppression({ member: undefined })] })).findings).toEqual([]);
  });

  it('does not suppress another member', () => {
    expect(applyRuleConfig([finding()], config({ suppressions: [suppression({ member: 'cancel' })] })).findings).toEqual([finding()]);
  });

  it('does not suppress another rule on the same member', () => {
    expect(applyRuleConfig([finding()], config({ suppressions: [suppression({ rule: 'transition-drift' })] })).findings).toEqual([finding()]);
  });

  it('reports a suppression that matches nothing as stale', () => {
    const unused = suppression({ member: 'cancel' });

    expect(applyRuleConfig([finding()], config({ suppressions: [unused] })).stale).toEqual([unused]);
  });

  it('reports a suppression of a rule that is off as stale', () => {
    const unused = suppression({});

    expect(applyRuleConfig([finding()], config({ levels: new Map([['terminal-state-leak', 'off']]), suppressions: [unused] })).stale).toEqual([unused]);
  });

  it('never matches a handler finding without a handler class', () => {
    const orphan = flowFinding({ details: { ...flowFinding().details, handlerClassId: null, handlerMethod: null } });
    const outcome = applyRuleConfig([orphan], config({ suppressions: [suppression({ rule: 'dead-handler', classId: 'null', member: undefined })] }));

    expect(outcome.findings).toEqual([orphan]);
  });

  it('never matches a member on a rule anchored on the class', () => {
    const outcome = applyRuleConfig([unhandledFinding()], config({ suppressions: [suppression({ rule: 'unhandled-event', classId: unhandledFinding().details.eventId, member: 'handle' })] }));

    expect(outcome.findings).toEqual([unhandledFinding()]);
  });

  it.each<[string, Finding, string, string | undefined]>([
    ['terminal-state-leak on the method', finding(), finding().details.aggregateId, finding().details.method],
    ['unreachable-state on the field', unreachableFinding(), unreachableFinding().details.aggregateId, unreachableFinding().details.field],
    ['outside-mutation on the field', mutationFinding(), mutationFinding().details.aggregateId, mutationFinding().details.field],
    ['transition-drift on the method', driftFinding(), driftFinding().details.aggregateId, driftFinding().details.method],
    ['transition-missing on the method', missingFinding(), missingFinding().details.aggregateId, missingFinding().details.method],
    ['dead-handler on the handler method', flowFinding(), 'src/handlers.ts:RefundHandler', 'handle'],
    ['handler-payload-mismatch on the handler method', mismatchFinding(), mismatchFinding().details.handlerClassId ?? '', mismatchFinding().details.handlerMethod ?? undefined],
    ['unhandled-event on the event', unhandledFinding(), unhandledFinding().details.eventId, undefined],
    ['saga-missing-failure-path on the saga', sagaFinding(), sagaFinding().details.sagaId, undefined],
    ['undispatched-events on the buffer', bufferFinding(), bufferFinding().details.ownerId, bufferFinding().details.buffer],
  ])('anchors %s', (_, anchored, classId, member) => {
    const outcome = applyRuleConfig([anchored], config({ suppressions: [suppression({ rule: anchored.ruleId, classId, member })] }));

    expect(outcome.findings).toEqual([]);
  });
});

describe('enabledRules', () => {
  const rule = (id: string): RuleDescription => ({ id, severity: 'error', description: 'D', explanation: 'E', remedy: 'R' });

  it('leaves out rules that are off', () => {
    expect(enabledRules([rule('terminal-state-leak'), rule('dead-handler')], config({ levels: new Map([['dead-handler', 'off']]) })).map((kept) => kept.id)).toEqual([
      'terminal-state-leak',
    ]);
  });
});
