import { describe, expect, it } from 'vitest';
import { FindingOf, RuleId, DetailsByRule } from '../../src/finding';
import { findingKey } from '../../src/report/key';

const of = <R extends RuleId>(ruleId: R, analyzer: FindingOf<R>['analyzer'], details: DetailsByRule[R]): FindingOf<R> =>
  ({ ruleId, analyzer, severity: 'error', file: '/app/src/a.ts', line: 1, message: 'M', fix: 'F', details }) as FindingOf<R>;

describe('findingKey', () => {
  it('keys a terminal-state leak by aggregate, method, field and leaked values', () => {
    expect(findingKey(of('terminal-state-leak', 'lifecycle', { aggregate: 'Order', aggregateId: 'Order', method: 'annotate', field: 'status', values: ['CANCELLED', 'REFUNDED'] }))).toBe(
      'terminal-state-leak|Order|annotate|status|CANCELLED,REFUNDED',
    );
  });

  it('keys an unreachable state with an empty method segment', () => {
    expect(findingKey(of('unreachable-state', 'lifecycle', { aggregate: 'Order', aggregateId: 'Order', field: 'status', value: 'PAID' }))).toBe('unreachable-state|Order||status|PAID');
  });

  it('keys an outside mutation by its scope', () => {
    expect(findingKey(of('outside-mutation', 'lifecycle', { aggregate: 'Order', aggregateId: 'Order', field: 'status', scope: 'Mapper.reopen' }))).toBe('outside-mutation|Order||status|Mapper.reopen');
  });

  it('keys transition drift by its kind and not its values', () => {
    expect(findingKey(of('transition-drift', 'lifecycle', { aggregate: 'Order', aggregateId: 'Order', method: 'cancel', field: 'status', kind: 'extra', values: ['PAID'] }))).toBe('transition-drift|Order|cancel|status|extra');
  });

  it('keys a missing transition with the missing suffix', () => {
    expect(findingKey(of('transition-missing', 'lifecycle', { aggregate: 'Order', aggregateId: 'Order', method: 'place', field: 'status', values: ['PAID'] }))).toBe('transition-missing|Order|place|status|missing');
  });

  it('keys a dead handler without a handler as an empty segment', () => {
    expect(findingKey(of('dead-handler', 'event-flow', { event: 'Refunded', eventId: 'Refunded', handler: null, handlerClassId: null, handlerMethod: null }))).toBe('dead-handler|Refunded||');
  });

  it('keys a payload mismatch by the declared class ids', () => {
    expect(findingKey(of('handler-payload-mismatch', 'event-flow', { event: 'Placed', eventId: 'Placed', handler: 'H.handle', handlerClassId: 'src/h.ts:H', handlerMethod: 'handle', declared: ['Paid', 'Shipped'], declaredIds: ['Paid', 'src/b.ts:Shipped'] }))).toBe(
      'handler-payload-mismatch|Placed|H.handle|Paid,src/b.ts:Shipped',
    );
  });

  it('keys an unhandled event by its id alone', () => {
    expect(findingKey(of('unhandled-event', 'event-flow', { event: 'Shipped', eventId: 'Shipped' }))).toBe('unhandled-event|Shipped||');
  });

  it('keys a missing failure path by failure, saga and success ids', () => {
    expect(
      findingKey(of('saga-missing-failure-path', 'event-flow', { saga: 'OrderSaga', sagaId: 'OrderSaga', success: 'Captured', successId: 'Captured', failure: 'Failed', failureId: 'Failed' })),
    ).toBe('saga-missing-failure-path|Failed|OrderSaga|Captured');
  });

  it('keys undispatched events by owner and buffer', () => {
    expect(findingKey(of('undispatched-events', 'event-flow', { owner: 'Root', ownerId: 'Root', buffer: 'events', method: 'add', raisers: ['Order'] }))).toBe('undispatched-events|Root|events|');
  });
});
