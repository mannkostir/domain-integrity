import { describe, expect, it } from 'vitest';
import { eventFlowSummary } from '../../../src/analyzers/event-flow/summary';
import { flowModel, registration } from '../../helpers/event-flow-model';

describe('eventFlowSummary', () => {
  it('lists each event with its handlers', () => {
    const model = flowModel({ registrations: [registration(), registration({ handlerClass: 'OrderSaga', handlerMethod: 'paid' })] });

    expect(eventFlowSummary(model, '/app')).toBe(['## Event flows', '', '- Paid (src/Paid.ts) → PaidHandler.handle, OrderSaga.paid', ''].join('\n'));
  });

  it('is empty without registrations', () => {
    expect(eventFlowSummary(flowModel({ registrations: [] }), '/app')).toBe('');
  });
});
