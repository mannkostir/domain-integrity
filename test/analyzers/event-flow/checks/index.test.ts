import { describe, expect, it } from 'vitest';
import { EVENT_FLOW_RULES, runEventFlowChecks } from '../../../../src/analyzers/event-flow/checks';
import { eventClass, flowModel } from '../../../helpers/event-flow-model';

describe('event-flow checks', () => {
  it('lists the five rules', () => {
    expect(EVENT_FLOW_RULES.map((rule) => rule.id)).toEqual(['dead-handler', 'handler-payload-mismatch', 'unhandled-event', 'saga-missing-failure-path', 'undispatched-events']);
  });

  it('runs every check and sorts by location', () => {
    const model = flowModel({ events: new Map([['Paid', eventClass('Paid', { constructions: [] })]]) });

    expect(runEventFlowChecks(model).map((finding) => finding.checkId)).toEqual(['dead-handler']);
  });
});
