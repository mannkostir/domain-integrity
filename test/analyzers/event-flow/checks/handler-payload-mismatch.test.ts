import { describe, expect, it } from 'vitest';
import { handlerPayloadMismatch } from '../../../../src/analyzers/event-flow/checks/handler-payload-mismatch';
import { classRef, eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

const payload = (classes: readonly string[]) => ({ kind: 'classes' as const, classes, file: '/app/src/handlers.ts', line: 5 });

const withPayload = (classes: readonly string[]) =>
  flowModel({
    events: new Map([['Paid', eventClass('Paid', { ancestors: ['Base'] })]]),
    registrations: [registration({ payload: payload(classes) })],
  });

describe('handlerPayloadMismatch', () => {
  it('reports a parameter typed as an unrelated class', () => {
    expect(handlerPayloadMismatch(withPayload(['Failed']))).toEqual([
      {
        ruleId: 'handler-payload-mismatch',
        severity: 'error',
        analyzer: 'event-flow',
        file: '/app/src/handlers.ts',
        line: 5,
        message: 'PaidHandler.handle is registered for Paid but declares its event as Failed.',
        fix: 'Type the parameter as Paid, or register the handler for Failed.',
        details: { event: 'Paid', eventId: 'Paid', handler: 'PaidHandler.handle', handlerClassId: 'PaidHandler', handlerMethod: 'handle', declared: ['Failed'], declaredIds: ['Failed'] },
      },
    ]);
  });

  it('reports a union with no matching member and names every member', () => {
    expect(handlerPayloadMismatch(withPayload(['Failed', 'OrderSaga'])).map((finding) => [finding.details.declaredIds.join(','), finding.message])).toEqual([
      ['Failed,OrderSaga', 'PaidHandler.handle is registered for Paid but declares its event as Failed | OrderSaga.'],
    ]);
  });

  it('accepts the event itself, an ancestor, a union containing either, and unreadable payloads', () => {
    expect([
      handlerPayloadMismatch(withPayload(['Paid'])),
      handlerPayloadMismatch(withPayload(['Base'])),
      handlerPayloadMismatch(withPayload(['Failed', 'Paid'])),
      handlerPayloadMismatch(flowModel()),
    ]).toEqual([[], [], [], []]);
  });

  it('skips a handler registered in a test file', () => {
    const model = flowModel({
      events: new Map([['Paid', eventClass('Paid')]]),
      registrations: [registration({ payload: payload(['Failed']), inTest: true })],
    });

    expect(handlerPayloadMismatch(model)).toEqual([]);
  });

  it('stays silent for an event whose hierarchy is opaque', () => {
    const model = flowModel({
      events: new Map([['OrderPaid', eventClass('OrderPaid', { opaque: true })]]),
      registrations: [registration({ event: 'OrderPaid', payload: payload(['DomainEvent']) })],
    });

    expect(handlerPayloadMismatch(model)).toEqual([]);
  });

  describe('with a qualified handler class id', () => {
    const modelWithMismatch = flowModel({
      classes: new Map([
        ['Paid', classRef('Paid')],
        ['Failed', classRef('Failed')],
        ['src/handlers.ts:RefundHandler', { ...classRef('RefundHandler'), id: 'src/handlers.ts:RefundHandler', qualifiedName: 'src/handlers.ts:RefundHandler' }],
      ]),
      events: new Map([['Paid', eventClass('Paid')]]),
      registrations: [registration({ handlerClass: 'src/handlers.ts:RefundHandler', handlerMethod: 'handle', payload: payload(['Failed']) })],
    });

    it('labels the handler with its class name, not its id', () => {
      expect(handlerPayloadMismatch(modelWithMismatch).map((finding) => finding.details.handler)).toEqual(['RefundHandler.handle']);
    });

    it('carries the handler class id and method for the identity', () => {
      expect(handlerPayloadMismatch(modelWithMismatch).map(({ details }) => [details.handlerClassId, details.handlerMethod])).toEqual([['src/handlers.ts:RefundHandler', 'handle']]);
    });
  });
});
