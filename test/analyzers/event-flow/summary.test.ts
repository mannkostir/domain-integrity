import { describe, expect, it } from 'vitest';
import { eventFlowSummary } from '../../../src/analyzers/event-flow/summary';
import { classRef, flowModel, registration } from '../../helpers/event-flow-model';

describe('eventFlowSummary', () => {
  it('lists each event with its handlers', () => {
    const model = flowModel({ registrations: [registration(), registration({ handlerClass: 'OrderSaga', handlerMethod: 'paid' })] });

    expect(eventFlowSummary(model, '/app')).toBe(['## Event flows', '', '- Paid (src/Paid.ts) → PaidHandler.handle, OrderSaga.paid', ''].join('\n'));
  });

  it('orders events by name rather than path', () => {
    const model = flowModel({
      classes: new Map([
        ['src/a.ts:Zeta', { ...classRef('Zeta'), id: 'src/a.ts:Zeta' }],
        ['src/z.ts:Alpha', { ...classRef('Alpha'), id: 'src/z.ts:Alpha' }],
      ]),
      registrations: [registration({ event: 'src/a.ts:Zeta' }), registration({ event: 'src/z.ts:Alpha' })],
    });

    expect(eventFlowSummary(model, '/app').split('\n').filter((line) => line.startsWith('- ')).map((line) => line.split(' ')[1])).toEqual(['Alpha', 'Zeta']);
  });

  it('is empty without registrations', () => {
    expect(eventFlowSummary(flowModel({ registrations: [] }), '/app')).toBe('');
  });
});
