import { describe, expect, it } from 'vitest';
import { DetailsByRule, Finding, FindingOf, RuleId } from '../../src/finding';
import { bufferFinding, driftFinding, flowFinding, mismatchFinding, missingFinding, mutationFinding, sagaFinding, unhandledFinding, unreachableFinding, finding as leakFinding } from '../helpers/model';
import { IDENTITY_FIELDS, Identity, describeIdentity, identityOf, serializeIdentity } from '../../src/report/identity';

const ROOT = '/repo';

const of = <R extends RuleId>(ruleId: R, analyzer: FindingOf<R>['analyzer'], details: DetailsByRule[R]): FindingOf<R> =>
  ({ ruleId, analyzer, severity: 'error', file: '/repo/src/mapper.ts', line: 7, message: 'M', fix: 'F', details }) as FindingOf<R>;

const ORDER = { aggregate: 'Order', aggregateId: 'src/order.ts:Order' };

describe('identityOf', () => {
  it('identifies a terminal-state leak by aggregate, method, field and sorted values', () => {
    expect(identityOf(of('terminal-state-leak', 'lifecycle', { ...ORDER, method: 'annotate', field: 'status', values: ['REFUNDED', 'CANCELLED'] }), ROOT)).toEqual({
      rule: 'terminal-state-leak', aggregate: 'src/order.ts:Order', method: 'annotate', field: 'status', values: ['CANCELLED', 'REFUNDED'],
    });
  });

  it('identifies an unreachable state by aggregate, field and value', () => {
    expect(identityOf(of('unreachable-state', 'lifecycle', { ...ORDER, field: 'status', value: 'PAID' }), ROOT)).toEqual({
      rule: 'unreachable-state', aggregate: 'src/order.ts:Order', field: 'status', value: 'PAID',
    });
  });

  it('identifies an outside mutation by aggregate, field, repository-relative file and scope', () => {
    expect(identityOf(of('outside-mutation', 'lifecycle', { ...ORDER, field: 'status', scope: 'Mapper.reopen' }), ROOT)).toEqual({
      rule: 'outside-mutation', aggregate: 'src/order.ts:Order', field: 'status', file: 'src/mapper.ts', scope: 'Mapper.reopen',
    });
  });

  it('identifies transition drift by kind and not by values', () => {
    expect(identityOf(of('transition-drift', 'lifecycle', { ...ORDER, method: 'cancel', field: 'status', kind: 'extra', values: ['PAID'] }), ROOT)).toEqual({
      rule: 'transition-drift', aggregate: 'src/order.ts:Order', method: 'cancel', field: 'status', kind: 'extra',
    });
  });

  it('identifies a missing transition without its values', () => {
    expect(identityOf(of('transition-missing', 'lifecycle', { ...ORDER, method: 'place', field: 'status', values: ['PAID'] }), ROOT)).toEqual({
      rule: 'transition-missing', aggregate: 'src/order.ts:Order', method: 'place', field: 'status',
    });
  });

  it('identifies a dead handler by event and handler class id and method', () => {
    expect(identityOf(of('dead-handler', 'event-flow', { event: 'Refunded', eventId: 'src/e.ts:Refunded', handler: 'H.handle', handlerClassId: 'src/h.ts:H', handlerMethod: 'handle' }), ROOT)).toEqual({
      rule: 'dead-handler', event: 'src/e.ts:Refunded', handlerClass: 'src/h.ts:H', handlerMethod: 'handle',
    });
  });

  it('identifies a payload mismatch by sorted declared ids', () => {
    expect(
      identityOf(of('handler-payload-mismatch', 'event-flow', { event: 'Placed', eventId: 'src/e.ts:Placed', handler: null, handlerClassId: null, handlerMethod: null, declared: ['Shipped', 'Paid'], declaredIds: ['src/e.ts:Shipped', 'src/e.ts:Paid'] }), ROOT),
    ).toEqual({ rule: 'handler-payload-mismatch', event: 'src/e.ts:Placed', handlerClass: null, handlerMethod: null, declared: ['src/e.ts:Paid', 'src/e.ts:Shipped'] });
  });

  it('identifies an unhandled event by its id', () => {
    expect(identityOf(of('unhandled-event', 'event-flow', { event: 'Shipped', eventId: 'src/e.ts:Shipped' }), ROOT)).toEqual({ rule: 'unhandled-event', event: 'src/e.ts:Shipped' });
  });

  it('identifies a missing failure path by saga, success and failure ids', () => {
    expect(
      identityOf(of('saga-missing-failure-path', 'event-flow', { saga: 'S', sagaId: 'src/s.ts:S', success: 'Ok', successId: 'src/e.ts:Ok', failure: 'Ko', failureId: 'src/e.ts:Ko' }), ROOT),
    ).toEqual({ rule: 'saga-missing-failure-path', saga: 'src/s.ts:S', success: 'src/e.ts:Ok', failure: 'src/e.ts:Ko' });
  });

  it('identifies undispatched events by owner and buffer', () => {
    expect(identityOf(of('undispatched-events', 'event-flow', { owner: 'Root', ownerId: 'src/r.ts:Root', buffer: 'events', method: 'raise', raisers: ['place'] }), ROOT)).toEqual({
      rule: 'undispatched-events', owner: 'src/r.ts:Root', buffer: 'events',
    });
  });

  it('orders identity keys as rule then the declared fields', () => {
    const identity = identityOf(of('outside-mutation', 'lifecycle', { ...ORDER, field: 'status', scope: 'Mapper.reopen' }), ROOT);
    expect(Object.keys(identity)).toEqual(['rule', ...IDENTITY_FIELDS['outside-mutation']]);
  });
});

const SAMPLES: Readonly<Record<RuleId, Finding>> = {
  'terminal-state-leak': leakFinding(),
  'unreachable-state': unreachableFinding(),
  'outside-mutation': mutationFinding(),
  'transition-drift': driftFinding(),
  'transition-missing': missingFinding(),
  'dead-handler': flowFinding(),
  'handler-payload-mismatch': mismatchFinding(),
  'unhandled-event': unhandledFinding(),
  'saga-missing-failure-path': sagaFinding(),
  'undispatched-events': bufferFinding(),
};

describe('identityOf key order', () => {
  it.each(Object.keys(IDENTITY_FIELDS) as RuleId[])('lists the keys of %s as the rule then its declared fields', (ruleId) => {
    expect(Object.keys(identityOf(SAMPLES[ruleId], '/app'))).toEqual(['rule', ...IDENTITY_FIELDS[ruleId]]);
  });
});

const MUTATION: Identity = { rule: 'outside-mutation', aggregate: 'src/order.ts:Order', field: 'status', file: 'src/mapper.ts', scope: 'Mapper.reopen' };

describe('serializeIdentity', () => {
  it('serializes as a JSON array of the rule and the field values in order', () => {
    expect(serializeIdentity(MUTATION)).toBe('["outside-mutation","src/order.ts:Order","status","src/mapper.ts","Mapper.reopen"]');
  });
});

describe('describeIdentity', () => {
  it('names each field, joins arrays with commas and shows null as a dash', () => {
    expect(describeIdentity({ rule: 'handler-payload-mismatch', event: 'src/e.ts:Placed', handlerClass: null, handlerMethod: 'on', declared: ['A', 'B'] })).toBe(
      'handler-payload-mismatch event=src/e.ts:Placed handlerClass=- handlerMethod=on declared=A,B',
    );
  });
});
