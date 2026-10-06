import { describe, expect, it } from 'vitest';
import { terminalStateLeak } from '../../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { aggregate, assigned, declared, known, method, stateField, STATUS, unknownSources } from '../../../helpers/model';

const ALL = known('PENDING', 'CONFIRMED', 'CANCELLED');
const QUALIFIED = 'src/a/order.ts:Order';
const PHASE = stateField('phase', 'enum', ['OPEN', 'CLOSED']);
const BOTH_LEAK = method('archive', true, {
  status: { sources: ALL, sets: assigned() },
  phase: { sources: known('OPEN', 'CLOSED'), sets: assigned() },
});
const twoFields = (statusAllows: string[], phaseAllows: string[], allowAfterTerminal: string[] = []) =>
  aggregate({
    fields: [STATUS, PHASE],
    declarations: new Map([
      ['status', declared(['CANCELLED'], undefined, statusAllows)],
      ['phase', declared(['CLOSED'], undefined, phaseAllows)],
    ]),
    allowAfterTerminal: new Set(allowAfterTerminal),
    methods: [BOTH_LEAK],
  });

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

  it('flags a method on every terminal field when no list exempts it', () => {
    expect(terminalStateLeak(twoFields([], [])).map((finding) => finding.field)).toEqual(['status', 'phase']);
  });

  it('exempts a method only for the field whose own list names it', () => {
    expect(terminalStateLeak(twoFields(['archive'], [])).map((finding) => finding.field)).toEqual(['phase']);
  });

  it('exempts a method for every field when the aggregate list names it', () => {
    expect(terminalStateLeak(twoFields([], [], ['archive']))).toEqual([]);
  });

  it('combines the aggregate list with the field list', () => {
    const model = aggregate({
      declarations: new Map([['status', declared(['CANCELLED'], undefined, ['annotate'])]]),
      allowAfterTerminal: new Set(['archive']),
      methods: [
        method('annotate', true, { status: { sources: ALL, sets: assigned() } }),
        method('archive', true, { status: { sources: ALL, sets: assigned() } }),
      ],
    });

    expect(terminalStateLeak(model)).toEqual([]);
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
