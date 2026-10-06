import { describe, expect, it } from 'vitest';
import { outsideMutation } from '../../../../src/analyzers/lifecycle/checks/outside-mutation';
import { aggregate, assigned } from '../../../helpers/model';

const ASSIGNMENT = { field: 'status', file: '/app/src/spec.ts', line: 7, scope: 'WithStatus.mutate', value: assigned('CANCELLED'), throughOwnSetter: false };
const QUALIFIED = 'src/a/order.ts:Order';

describe('outsideMutation', () => {
  it('flags an assignment to a declared state field outside the aggregate', () => {
    expect(outsideMutation(aggregate({ outside: [ASSIGNMENT] }))).toEqual([
      {
        analyzer: 'lifecycle',
        checkId: 'outside-mutation',
        severity: 'error',
        aggregate: 'Order',
        aggregateId: 'Order',
        method: undefined,
        field: 'status',
        subject: 'WithStatus.mutate',
        file: '/app/src/spec.ts',
        line: 7,
        message: 'status of Order is assigned outside the aggregate in WithStatus.mutate.',
        fix: 'Move this change into a method on Order so its guards apply.',
      },
    ]);
  });

  it('ignores fields that are not declared', () => {
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, field: 'note' }] }))).toEqual([]);
  });

  it('ignores an assignment made through the aggregate setter', () => {
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, throughOwnSetter: true }] }))).toEqual([]);
  });

  it('identifies findings by the aggregate id', () => {
    expect(
      outsideMutation(aggregate({ id: QUALIFIED, outside: [ASSIGNMENT] })).map((finding) => finding.aggregateId),
    ).toEqual([QUALIFIED]);
  });
});
