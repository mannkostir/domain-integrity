import { describe, expect, it } from 'vitest';
import { sagaMissingFailurePath, sagaProblems } from '../../../../src/analyzers/event-flow/checks/saga-missing-failure-path';
import { EventFlowModel, Registration, SagaModel } from '../../../../src/analyzers/event-flow/model';
import { eventClass, flowModel, registration } from '../../../helpers/event-flow-model';

const SAGA: SagaModel = { id: 'OrderSaga', ancestors: [], extendsForeign: false, outcomes: [['Paid', 'Failed']] };

const sagaModel = (registrations: readonly Registration[], rest: Partial<EventFlowModel> = {}) =>
  flowModel({
    events: new Map([['Paid', eventClass('Paid')], ['Failed', eventClass('Failed', { ancestors: ['Base'] })]]),
    registrations,
    sagas: [SAGA],
    ...rest,
  });

const handles = (event: string, handlerClass = 'OrderSaga') => registration({ event, handlerClass, handlerMethod: event.toLowerCase() });

describe('sagaMissingFailurePath', () => {
  it('reports a saga that handles the success but not the failure', () => {
    expect(sagaMissingFailurePath(sagaModel([handles('Paid')]))).toEqual([
      {
        analyzer: 'event-flow',
        checkId: 'saga-missing-failure-path',
        severity: 'error',
        event: 'Failed',
        eventId: 'Failed',
        handler: 'OrderSaga',
        subject: 'Paid',
        file: '/app/src/OrderSaga.ts',
        line: 1,
        message: 'OrderSaga handles Paid but not its declared failure Failed.',
        fix: 'Handle Failed in OrderSaga, for example with a compensating command.',
      },
    ]);
  });

  it('accepts handling of the failure itself, an ancestor of it, by a saga ancestor, or in a test file', () => {
    expect([
      sagaMissingFailurePath(sagaModel([handles('Paid'), handles('Failed')])),
      sagaMissingFailurePath(sagaModel([handles('Paid'), handles('Base')])),
      sagaMissingFailurePath(sagaModel([handles('Paid'), handles('Failed', 'Base')], { sagas: [{ ...SAGA, ancestors: ['Base'] }] })),
      sagaMissingFailurePath(sagaModel([handles('Paid'), { ...handles('Failed'), inTest: true }])),
    ]).toEqual([[], [], [], []]);
  });

  it('stays silent with an unresolved site in the saga or a foreign base', () => {
    expect([
      sagaMissingFailurePath(sagaModel([handles('Paid')], { unresolved: [{ owner: 'OrderSaga', file: '/app/src/OrderSaga.ts', line: 3 }] })),
      sagaMissingFailurePath(sagaModel([handles('Paid')], { sagas: [{ ...SAGA, extendsForeign: true }] })),
    ]).toEqual([[], []]);
  });

  it('ignores another class handling the failure', () => {
    expect(sagaMissingFailurePath(sagaModel([handles('Paid'), handles('Failed', 'PaidHandler')])).length).toBe(1);
  });
});

describe('sagaProblems', () => {
  it('reports a resolved saga that handles neither side of an outcome', () => {
    expect(sagaProblems(sagaModel([]))).toEqual(['saga(OrderSaga) declares the outcome Paid → Failed, but OrderSaga handles neither.']);
  });

  it('stays silent for a saga that is silenced or handles either side', () => {
    expect([
      sagaProblems(sagaModel([], { sagas: [{ ...SAGA, extendsForeign: true }] })),
      sagaProblems(sagaModel([handles('Failed')])),
    ]).toEqual([[], []]);
  });
});
