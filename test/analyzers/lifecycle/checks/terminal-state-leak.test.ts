import { describe, expect, it } from 'vitest';
import { terminalStateLeak } from '../../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { aggregate, assigned, known, method, unknownSources } from '../../../helpers/model';

const ALL = known('PENDING', 'CONFIRMED', 'CANCELLED');
const QUALIFIED = 'src/a/order.ts:Order';

describe('terminalStateLeak', () => {
  it('flags a mutating method that can run in a terminal state', () => {
    const findings = terminalStateLeak(
      aggregate({ methods: [method('annotate', true, { status: { sources: ALL, sets: assigned() } })] }),
    );

    expect(findings).toEqual([
      {
        checkId: 'terminal-state-leak',
        severity: 'error',
        aggregate: 'Order',
        aggregateId: 'Order',
        method: 'annotate',
        field: 'status',
        subject: 'CANCELLED',
        file: '/app/src/order.ts',
        line: 10,
        message: "annotate() can run after status is 'cancelled'.",
        fix: "Guard annotate() so it cannot run when status is 'cancelled', or list it in allowAfterTerminal if that is intended.",
      },
    ]);
  });

  it('flags a public method that can run in a terminal state', () => {
    const methods = [method('annotate', true, { status: { sources: ALL, sets: assigned() } }, 'public')];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([expect.objectContaining({ method: 'annotate' })]);
  });

  it('ignores a private method that can run in a terminal state', () => {
    const methods = [method('onAnnotated', true, { status: { sources: ALL, sets: assigned() } }, 'private')];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores a protected method that can run in a terminal state', () => {
    const methods = [method('onAnnotated', true, { status: { sources: ALL, sets: assigned() } }, 'protected')];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores a method whose guard excludes the terminal state', () => {
    const methods = [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores a method that changes nothing', () => {
    const methods = [method('describe', false, { status: { sources: ALL, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('ignores methods listed in allowAfterTerminal', () => {
    const methods = [method('archive', true, { status: { sources: ALL, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods, allowAfterTerminal: new Set(['archive']) }))).toEqual([]);
  });

  it('stays silent when the guard could not be analysed', () => {
    const methods = [method('annotate', true, { status: { sources: unknownSources, sets: assigned() } })];

    expect(terminalStateLeak(aggregate({ methods }))).toEqual([]);
  });

  it('identifies findings by the aggregate id', () => {
    expect(
      terminalStateLeak(
        aggregate({ id: QUALIFIED, methods: [method('annotate', true, { status: { sources: ALL, sets: assigned() } })] }),
      ).map((finding) => finding.aggregateId),
    ).toEqual([QUALIFIED]);
  });
});
