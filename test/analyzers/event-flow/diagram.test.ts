import { describe, expect, it } from 'vitest';
import { eventFlowDiagram } from '../../../src/analyzers/event-flow/diagram';
import { classRef, eventClass, flowModel, registration } from '../../helpers/event-flow-model';

const MODEL = flowModel({
  classes: new Map(['Paid', 'Failed', 'PaidHandler', 'OrderSaga'].map((id) => [id, classRef(id)])),
  events: new Map([['Paid', eventClass('Paid')], ['Failed', eventClass('Failed')]]),
  registrations: [registration(), registration({ handlerClass: 'OrderSaga', handlerMethod: 'paid' }), registration({ event: 'Failed', handlerClass: undefined, handlerMethod: undefined })],
});

describe('eventFlowDiagram', () => {
  it('draws every event with its handlers', () => {
    expect(eventFlowDiagram(MODEL, undefined)).toEqual({
      kind: 'diagram',
      text: [
        '## Event flows',
        '',
        '```mermaid',
        'flowchart LR',
        '  event_0["Failed"] --> handler_0["(inline)"]',
        '  event_1["Paid"] --> handler_1["PaidHandler.handle"]',
        '  event_1["Paid"] --> handler_2["OrderSaga.paid"]',
        '```',
      ].join('\n'),
    });
  });

  it('restricts to a named event and contributes nothing for an unknown name', () => {
    expect([eventFlowDiagram(MODEL, 'Failed'), eventFlowDiagram(MODEL, 'Order')]).toEqual([
      { kind: 'diagram', text: ['## Event flows', '', '```mermaid', 'flowchart LR', '  event_0["Failed"] --> handler_0["(inline)"]', '```'].join('\n') },
      { kind: 'diagram', text: '' },
    ]);
  });

  it('reports an ambiguous event name', () => {
    const shared = flowModel({
      classes: new Map([
        ['src/a.ts:Paid', { ...classRef('Paid'), id: 'src/a.ts:Paid', qualifiedName: 'src/a.ts:Paid' }],
        ['src/b.ts:Paid', { ...classRef('Paid'), id: 'src/b.ts:Paid', qualifiedName: 'src/b.ts:Paid' }],
      ]),
      events: new Map([['src/a.ts:Paid', eventClass('src/a.ts:Paid')], ['src/b.ts:Paid', eventClass('src/b.ts:Paid')]]),
      registrations: [registration({ event: 'src/a.ts:Paid' }), registration({ event: 'src/b.ts:Paid' })],
    });

    expect(eventFlowDiagram(shared, 'Paid')).toEqual({ kind: 'ambiguous', reference: 'Paid', candidates: ['src/a.ts:Paid', 'src/b.ts:Paid'] });
  });
});
