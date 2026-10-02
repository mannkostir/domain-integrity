import { describe, expect, it } from 'vitest';
import { formatText } from '../../src/report/text';
import { finding } from '../helpers/model';

describe('formatText', () => {
  it('lists fresh findings, then known ones, then a summary', () => {
    const text = formatText({
      fresh: [finding({})],
      known: [finding({ checkId: 'unreachable-state', method: undefined, line: 3, message: 'M2', fix: 'F2' })],
      problems: [],
      rules: [],
      root: '/app',
    });

    expect(text).toBe(
      [
        'error terminal-state-leak  Order.annotate()  src/order.ts:10',
        '  M1',
        '  Fix: F1',
        '',
        'error unreachable-state  Order  src/order.ts:3 (baseline)',
        '  M2',
        '  Fix: F2',
        '',
        '1 error, 0 warnings, 1 known from baseline',
        '',
      ].join('\n'),
    );
  });

  it('prints only the summary when there is nothing to report', () => {
    expect(formatText({ fresh: [], known: [], problems: [], rules: [], root: '/app' })).toBe('0 errors, 0 warnings\n');
  });
});
