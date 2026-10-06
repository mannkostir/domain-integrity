import { describe, expect, it } from 'vitest';
import { deadHandler } from '../../../../src/analyzers/event-flow/checks/dead-handler';
import { eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

const withPaid = (overrides: Parameters<typeof eventClass>[1]) => flowModel({ events: new Map([['Paid', eventClass('Paid', overrides)]]) });

describe('deadHandler', () => {
  it('reports a handler whose event is never constructed', () => {
    expect(deadHandler(withPaid({ constructions: [] }))).toEqual([
      {
        analyzer: 'event-flow',
        checkId: 'dead-handler',
        severity: 'error',
        event: 'Paid',
        eventId: 'Paid',
        handler: 'PaidHandler.handle',
        subject: '',
        file: '/app/src/handlers.ts',
        line: 4,
        message: 'PaidHandler.handle handles Paid, but no production code constructs Paid.',
        fix: 'Publish Paid where it happens, or delete the handler.',
      },
    ]);
  });

  it('stays silent for a constructed, abstract, subclassed or escaping event', () => {
    expect([
      deadHandler(withPaid({})),
      deadHandler(withPaid({ constructions: [], abstract: true })),
      deadHandler(withPaid({ constructions: [], subclassed: true })),
      deadHandler(withPaid({ constructions: [], escaped: true })),
    ]).toEqual([[], [], [], []]);
  });

  it('labels a class-level handler by its class and a classless one by its method', () => {
    const model = flowModel({
      events: new Map([['Paid', eventClass('Paid', { constructions: [] })]]),
      registrations: [
        registration({ handlerMethod: undefined }),
        registration({ handlerClass: undefined, handlerMethod: 'onPaid' }),
        registration({ handlerClass: undefined, handlerMethod: undefined }),
      ],
    });

    expect(deadHandler(model).map((finding) => finding.handler)).toEqual(['PaidHandler', 'onPaid', undefined]);
  });
});
