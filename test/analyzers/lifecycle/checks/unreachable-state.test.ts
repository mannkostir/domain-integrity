import { describe, expect, it } from 'vitest';
import { unreachableState } from '../../../../src/analyzers/lifecycle/checks/unreachable-state';
import { aggregate, assigned, declared, known, method, stateField, unresolvedValue, mayWriteValue } from '../../../helpers/model';

const CANCEL = method('cancel', true, { status: { sources: known('PENDING'), sets: assigned('CANCELLED') } });

describe('unreachableState', () => {
  it('flags a value that nothing assigns', () => {
    expect(unreachableState(aggregate({ methods: [CANCEL] }))).toEqual([
      {
        checkId: 'unreachable-state',
        severity: 'error',
        aggregate: 'Order',
        method: undefined,
        field: 'status',
        subject: 'CONFIRMED',
        file: '/app/src/order.ts',
        line: 3,
        message: "status value 'confirmed' is never assigned.",
        fix: "Add the method that moves Order into 'confirmed', or remove the value from the type.",
      },
    ]);
  });

  it('counts assignments outside the aggregate as reaching a value', () => {
    const outside = [{ field: 'status', file: '/app/src/x.ts', line: 1, scope: 'x', value: assigned('CONFIRMED') }];

    expect(unreachableState(aggregate({ methods: [CANCEL], outside }))).toEqual([]);
  });

  it('does not flag a value that is mentioned where it could be written', () => {
    const mentioned = new Map([['status', new Set(['CONFIRMED'])]]);

    expect(unreachableState(aggregate({ methods: [CANCEL], mentioned }))).toEqual([]);
  });

  it('stays silent when any assignment is unresolved', () => {
    const initial = new Map([['status', unresolvedValue]]);

    expect(unreachableState(aggregate({ methods: [CANCEL], initial }))).toEqual([]);
  });

  it('stays silent when a method may write through an escape', () => {
    const escaping = method('toJSON', false, { status: { sources: known('PENDING'), sets: mayWriteValue } });

    expect(unreachableState(aggregate({ methods: [CANCEL, escaping] }))).toEqual([]);
  });

  it('ignores boolean fields', () => {
    const deleted = stateField('deleted', 'boolean', ['true', 'false']);

    expect(
      unreachableState(
        aggregate({ fields: [deleted], declarations: new Map([['deleted', declared(['true'])]]), initial: new Map() }),
      ),
    ).toEqual([]);
  });
});
