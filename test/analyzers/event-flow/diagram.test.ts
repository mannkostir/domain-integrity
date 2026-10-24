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
    expect(eventFlowDiagram(MODEL, undefined)).toMatchObject({
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

  it('orders events by name rather than path', () => {
    const model = flowModel({
      classes: new Map([
        ['src/a.ts:Zeta', { ...classRef('Zeta'), id: 'src/a.ts:Zeta' }],
        ['src/z.ts:Alpha', { ...classRef('Alpha'), id: 'src/z.ts:Alpha' }],
      ]),
      registrations: [registration({ event: 'src/a.ts:Zeta', handlerClass: undefined, handlerMethod: undefined }), registration({ event: 'src/z.ts:Alpha', handlerClass: undefined, handlerMethod: undefined })],
    });

    expect(eventFlowDiagram(model, undefined)).toMatchObject({ text: expect.stringContaining('event_0["Alpha"] --> handler_0["(inline)"]\n  event_1["Zeta"]') });
  });

  it('restricts to a named event and contributes nothing for an unknown name', () => {
    expect([eventFlowDiagram(MODEL, 'Failed'), eventFlowDiagram(MODEL, 'Order')]).toMatchObject([
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

describe('eventFlowDiagram names', () => {
  it('names every handled event in name order when the named one is unknown', () => {
    expect(eventFlowDiagram(MODEL, 'Order')).toMatchObject({ names: ['Failed', 'Paid'] });
  });

  it('names every handled event when one of them is selected', () => {
    expect(eventFlowDiagram(MODEL, 'Paid')).toMatchObject({ names: ['Failed', 'Paid'] });
  });

  it('leaves events no handler registers for out of the names', () => {
    const model = flowModel({ events: new Map([['Paid', eventClass('Paid')], ['Failed', eventClass('Failed')]]) });

    expect(eventFlowDiagram(model, undefined)).toMatchObject({ names: ['Paid'] });
  });

  it('names same-named handled events by their qualified names', () => {
    const shared = flowModel({
      classes: new Map([
        ['src/a.ts:Paid', { ...classRef('Paid'), id: 'src/a.ts:Paid', qualifiedName: 'src/a.ts:Paid' }],
        ['src/b.ts:Paid', { ...classRef('Paid'), id: 'src/b.ts:Paid', qualifiedName: 'src/b.ts:Paid' }],
        ['Failed', classRef('Failed')],
      ]),
      registrations: [registration({ event: 'src/a.ts:Paid' }), registration({ event: 'src/b.ts:Paid' }), registration({ event: 'Failed' })],
    });

    expect(eventFlowDiagram(shared, undefined)).toMatchObject({ names: ['Failed', 'src/a.ts:Paid', 'src/b.ts:Paid'] });
  });
});
