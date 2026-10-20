import { describe, expect, it } from 'vitest';
import { outsideMutation } from '../../../../src/analyzers/lifecycle/checks/outside-mutation';
import { aggregate, assigned } from '../../../helpers/model';

const ASSIGNMENT = { field: 'status', file: '/app/src/spec.ts', line: 7, scope: 'WithStatus.mutate', value: assigned('CANCELLED'), throughOwnSetter: false, inTestFile: false };
const DEFAULTS = { reportTestFileMutations: false };
const QUALIFIED = 'src/a/order.ts:Order';

describe('outsideMutation', () => {
  it('flags an assignment to a declared state field outside the aggregate', () => {
    expect(outsideMutation(aggregate({ outside: [ASSIGNMENT] }), DEFAULTS)).toEqual([
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
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, field: 'note' }] }), DEFAULTS)).toEqual([]);
  });

  it('ignores an assignment made through the aggregate setter', () => {
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, throughOwnSetter: true }] }), DEFAULTS)).toEqual([]);
  });

  it('identifies findings by the aggregate id', () => {
    expect(
      outsideMutation(aggregate({ id: QUALIFIED, outside: [ASSIGNMENT] }), DEFAULTS).map((finding) => finding.aggregateId),
    ).toEqual([QUALIFIED]);
  });

  it('does not flag an assignment made in a test file by default', () => {
    expect(outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, inTestFile: true }] }), DEFAULTS)).toEqual([]);
  });

  it('flags an assignment made in a test file when test-file mutations are reported', () => {
    expect(
      outsideMutation(aggregate({ outside: [{ ...ASSIGNMENT, inTestFile: true }] }), { reportTestFileMutations: true }).map(
        (finding) => finding.subject,
      ),
    ).toEqual(['WithStatus.mutate']);
  });

  it('flags an assignment made in a production file when test-file mutations are not reported', () => {
    expect(outsideMutation(aggregate({ outside: [ASSIGNMENT] }), DEFAULTS).map((finding) => finding.subject)).toEqual([
      'WithStatus.mutate',
    ]);
  });
});
