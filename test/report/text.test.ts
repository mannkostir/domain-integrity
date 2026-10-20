import { describe, expect, it } from 'vitest';
import { formatText } from '../../src/report/text';
import { bufferFinding, finding, flowFinding, leakWith, unhandledFinding, unreachableFinding } from '../helpers/model';

describe('formatText', () => {
  const knownFinding = unreachableFinding();
  const appliedBaseline = { path: 'domain-integrity.baseline.json', stale: [] };

  it('omits known findings unless asked to show them', () => {
    const text = formatText(
      { fresh: [finding({})], known: [knownFinding], problems: [], rules: [], root: '/app', baseline: appliedBaseline },
      { showKnown: false },
    );

    expect(text).toBe(
      [
        'error terminal-state-leak  Order.annotate()  src/order.ts:10',
        '  M1',
        '  Fix: F1',
        '',
        '1 error, 0 warnings, 1 known from baseline domain-integrity.baseline.json',
        '',
      ].join('\n'),
    );
  });

  it('lists known findings after fresh ones when asked to show them', () => {
    const text = formatText(
      { fresh: [finding({})], known: [knownFinding], problems: [], rules: [], root: '/app', baseline: appliedBaseline },
      { showKnown: true },
    );

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
        '1 error, 0 warnings, 1 known from baseline domain-integrity.baseline.json',
        '',
      ].join('\n'),
    );
  });

  it('prints a single summary line when the baseline covers every finding', () => {
    const text = formatText(
      { fresh: [], known: [knownFinding, finding({ line: 5 }), leakWith({ method: 'close' }, { line: 7 })], problems: [], rules: [], root: '/app', baseline: appliedBaseline },
      { showKnown: false },
    );

    expect(text).toBe('0 errors, 0 warnings, 3 known from baseline domain-integrity.baseline.json\n');
  });

  it('names the baseline in the summary even when it matches nothing', () => {
    const text = formatText(
      { fresh: [], known: [], problems: [], rules: [], root: '/app', baseline: { path: 'ci/baseline.json', stale: [] } },
      { showKnown: false },
    );

    expect(text).toBe('0 errors, 0 warnings, 0 known from baseline ci/baseline.json\n');
  });

  it('lists a single stale baseline entry before the summary', () => {
    const text = formatText(
      { fresh: [], known: [], problems: [], rules: [], root: '/app', baseline: { path: 'b.json', stale: ['unreachable-state|Order||status|DRAFT'] } },
      { showKnown: false },
    );

    expect(text).toBe(
      [
        '1 stale baseline entry, remove with --update-baseline:',
        '  unreachable-state|Order||status|DRAFT',
        '',
        '0 errors, 0 warnings, 0 known from baseline b.json',
        '',
      ].join('\n'),
    );
  });

  it('lists several stale baseline entries before the summary', () => {
    const text = formatText(
      { fresh: [], known: [], problems: [], rules: [], root: '/app', baseline: { path: 'b.json', stale: ['a|A', 'b|B'] } },
      { showKnown: false },
    );

    expect(text).toBe(
      ['2 stale baseline entries, remove with --update-baseline:', '  a|A', '  b|B', '', '0 errors, 0 warnings, 0 known from baseline b.json', ''].join('\n'),
    );
  });

  it('prints only the summary when there is nothing to report', () => {
    expect(formatText({ fresh: [], known: [], problems: [], rules: [], root: '/app' }, { showKnown: false })).toBe('0 errors, 0 warnings\n');
  });

  it('names the aggregate by its id', () => {
    const text = formatText(
      { fresh: [leakWith({ aggregateId: 'src/order.ts:Order' })], known: [], problems: [], rules: [], root: '/app' },
      { showKnown: false },
    );

    expect(text.startsWith('error terminal-state-leak  src/order.ts:Order.annotate()  src/order.ts:10')).toBe(true);
  });

  it('locates an event-flow finding by event and handler', () => {
    const text = formatText({ fresh: [flowFinding({})], known: [], problems: [], rules: [], root: '/app' }, { showKnown: false });

    expect(text.split('\n')[0]).toBe('error dead-handler  RefundIssued → RefundHandler.handle  src/handlers.ts:4');
  });

  it('locates an event-flow finding without a handler by its event alone', () => {
    const text = formatText(
      { fresh: [unhandledFinding()], known: [], problems: [], rules: [], root: '/app' },
      { showKnown: false },
    );

    expect(text.split('\n')[0]).toBe('error unhandled-event  RefundIssued  src/handlers.ts:4');
  });

  it('locates an undispatched buffer by owner and buffer', () => {
    const text = formatText({ fresh: [bufferFinding()], known: [], problems: [], rules: [], root: '/app' }, { showKnown: false });

    expect(text.split('\n')[0]).toBe('error undispatched-events  AggregateRoot._domainEvents  src/aggregate-root.ts:3');
  });
});
