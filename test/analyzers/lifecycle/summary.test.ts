import { describe, expect, it } from 'vitest';
import { lifecycleSummary } from '../../../src/analyzers/lifecycle/summary';
import { aggregate, assigned, declared, DECLARED_ORDER, known, method, unknownSources, unresolvedValue, mayWriteValue } from '../../helpers/model';

describe('lifecycleSummary', () => {
  it('summarises declared lifecycles and the rules for agents', () => {
    expect(lifecycleSummary({ aggregates: [DECLARED_ORDER], problems: [] }, '/app')).toBe(
      [
        '## Domain lifecycles',
        '',
        'Rules for changing these aggregates:',
        '- Never change an aggregate after it reaches a terminal state, except through the listed methods.',
        "- Change state only through the aggregate's own methods.",
        '- Run `domain-integrity check` after changing domain code.',
        '',
        '### Order (src/order.ts)',
        '- status: pending, confirmed, cancelled',
        '  - terminal: cancelled',
        '  - confirm: pending → confirmed',
        '  - cancel: pending → cancelled',
        '',
      ].join('\n'),
    );
  });

  const summaryOf = (model: ReturnType<typeof aggregate>): string =>
    lifecycleSummary({ aggregates: [model], problems: [] }, '/app');

  it('prints terminal none when the terminal set is empty', () => {
    expect(summaryOf(aggregate({ declarations: new Map([['status', declared([])]]) }))).toContain('  - terminal: none\n');
  });

  it('shows computed for an unresolved assignment', () => {
    const model = aggregate({
      methods: [method('advance', true, { status: { sources: known('PENDING'), sets: unresolvedValue } })],
    });
    expect(summaryOf(model)).toContain('  - advance: pending → (computed) (observed)');
  });

  it('omits a method that only may write through an escape', () => {
    const model = aggregate({
      methods: [method('rename', true, { status: { sources: unknownSources, sets: mayWriteValue } })],
    });
    expect(summaryOf(model)).not.toContain('rename');
  });

  it('shows unknown for an undeclared method with unknown sources', () => {
    const model = aggregate({
      methods: [method('confirm', true, { status: { sources: unknownSources, sets: assigned('CONFIRMED') } })],
    });
    expect(summaryOf(model)).toContain('  - confirm: unknown → confirmed\n');
  });

  it('marks observed sources of an undeclared method', () => {
    const model = aggregate({
      methods: [method('confirm', true, { status: { sources: known('PENDING'), sets: assigned('CONFIRMED') } })],
    });
    expect(summaryOf(model)).toContain('  - confirm: pending → confirmed (observed)');
  });

  it('lists methods allowed after a terminal state', () => {
    expect(summaryOf(aggregate({ allowAfterTerminal: new Set(['touch', 'audit']) }))).toContain(
      '- may run after a terminal state: touch, audit',
    );
  });
});
