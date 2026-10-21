import { describe, expect, it } from 'vitest';
import { deadHandler } from '../../../../src/analyzers/event-flow/checks/dead-handler';
import { classRef, eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

const withPaid = (overrides: Parameters<typeof eventClass>[1]) => flowModel({ events: new Map([['Paid', eventClass('Paid', overrides)]]) });

describe('deadHandler', () => {
  it('reports a handler whose event is never constructed', () => {
    expect(deadHandler(withPaid({ constructions: [] }))).toEqual([
      {
        ruleId: 'dead-handler',
        severity: 'error',
        analyzer: 'event-flow',
        file: '/app/src/handlers.ts',
        line: 4,
        message: 'PaidHandler.handle handles Paid, but no production code constructs Paid.',
        fix: 'Publish Paid where it happens, or delete the handler.',
        details: { event: 'Paid', eventId: 'Paid', handler: 'PaidHandler.handle', handlerClassId: 'PaidHandler', handlerMethod: 'handle' },
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

    expect(deadHandler(model).map((finding) => finding.details.handler)).toEqual(['PaidHandler', 'onPaid', null]);
  });

  it('skips a handler registered in a test file', () => {
    const model = flowModel({ events: new Map([['Paid', eventClass('Paid', { constructions: [] })]]), registrations: [registration({ inTest: true })] });

    expect(deadHandler(model)).toEqual([]);
  });

  describe('with a qualified handler class id', () => {
    const modelWithDeadHandler = flowModel({
      classes: new Map([
        ['Paid', classRef('Paid')],
        ['src/handlers.ts:RefundHandler', { ...classRef('RefundHandler'), id: 'src/handlers.ts:RefundHandler', qualifiedName: 'src/handlers.ts:RefundHandler' }],
      ]),
      events: new Map([['Paid', eventClass('Paid', { constructions: [] })]]),
      registrations: [registration({ handlerClass: 'src/handlers.ts:RefundHandler', handlerMethod: 'handle' })],
    });

    it('labels the handler with its class name, not its id', () => {
      expect(deadHandler(modelWithDeadHandler).map((finding) => finding.details.handler)).toEqual(['RefundHandler.handle']);
    });

    it('names the handler by its class name in the message', () => {
      expect(deadHandler(modelWithDeadHandler).map((finding) => finding.message)).toEqual(['RefundHandler.handle handles Paid, but no production code constructs Paid.']);
    });

    it('carries the handler class id and method for the identity', () => {
      expect(deadHandler(modelWithDeadHandler).map(({ details }) => [details.handlerClassId, details.handlerMethod])).toEqual([['src/handlers.ts:RefundHandler', 'handle']]);
    });
  });
});
