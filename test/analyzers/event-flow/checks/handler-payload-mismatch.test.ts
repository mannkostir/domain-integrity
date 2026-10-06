import { describe, expect, it } from 'vitest';
import { handlerPayloadMismatch } from '../../../../src/analyzers/event-flow/checks/handler-payload-mismatch';
import { eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

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
        analyzer: 'event-flow',
        checkId: 'handler-payload-mismatch',
        severity: 'error',
        event: 'Paid',
        eventId: 'Paid',
        handler: 'PaidHandler.handle',
        subject: 'Failed',
        file: '/app/src/handlers.ts',
        line: 5,
        message: 'PaidHandler.handle is registered for Paid but declares its event as Failed.',
        fix: 'Type the parameter as Paid, or register the handler for Failed.',
      },
    ]);
  });

  it('reports a union with no matching member and names every member', () => {
    expect(handlerPayloadMismatch(withPayload(['Failed', 'OrderSaga'])).map((finding) => [finding.subject, finding.message])).toEqual([
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
});
