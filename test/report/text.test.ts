import { describe, expect, it } from 'vitest';
import { identityOf } from '../../src/report/identity';
import { formatText } from '../../src/report/text';
import { bufferFinding, finding, flowFinding, leakWith, mutationFinding, unhandledFinding, unreachableFinding } from '../helpers/model';

describe('formatText', () => {
  const knownFinding = unreachableFinding();
  const appliedBaseline = { path: 'domain-integrity.baseline.json', stale: [] };

  it('omits known findings unless asked to show them', () => {
    const text = formatText(
      { fresh: [finding({})], exceeded: new Map(), known: [knownFinding], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: appliedBaseline },
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
      { fresh: [finding({})], exceeded: new Map(), known: [knownFinding], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: appliedBaseline },
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
      { fresh: [], exceeded: new Map(), known: [knownFinding, finding({ line: 5 }), leakWith({ method: 'close' }, { line: 7 })], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: appliedBaseline },
      { showKnown: false },
    );

    expect(text).toBe('0 errors, 0 warnings, 3 known from baseline domain-integrity.baseline.json\n');
  });

  it('names the baseline in the summary even when it matches nothing', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: { path: 'ci/baseline.json', stale: [] } },
      { showKnown: false },
    );

    expect(text).toBe('0 errors, 0 warnings, 0 known from baseline ci/baseline.json\n');
  });

  it('lists a single stale baseline entry before the summary', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: { path: 'b.json', stale: [{ identity: identityOf(unreachableFinding(), '/app'), accepted: 1, found: 0 }] } },
      { showKnown: false },
    );

    expect(text).toBe(
      [
        '1 stale baseline entry, remove with --update-baseline:',
        '  unreachable-state aggregate=Order field=status value=CANCELLED',
        '',
        '0 errors, 0 warnings, 0 known from baseline b.json',
        '',
      ].join('\n'),
    );
  });

  it('lists several stale baseline entries before the summary', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: { path: 'b.json', stale: [{ identity: identityOf(unhandledFinding(), '/app'), accepted: 1, found: 0 }, { identity: identityOf(bufferFinding(), '/app'), accepted: 1, found: 0 }] } },
      { showKnown: false },
    );

    expect(text).toBe(
      ['2 stale baseline entries, remove with --update-baseline:', '  unhandled-event event=RefundIssued', '  undispatched-events owner=AggregateRoot buffer=_domainEvents', '', '0 errors, 0 warnings, 0 known from baseline b.json', ''].join('\n'),
    );
  });

  it('prints only the summary when there is nothing to report', () => {
    expect(formatText({ fresh: [], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' }, { showKnown: false })).toBe('0 errors, 0 warnings\n');
  });

  it('locates an event-flow finding by event and handler', () => {
    const text = formatText({ fresh: [flowFinding({})], known: [], exceeded: new Map(), suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' }, { showKnown: false });

    expect(text.split('\n')[0]).toBe('error dead-handler  RefundIssued → RefundHandler.handle  src/handlers.ts:4');
  });

  it('locates an event-flow finding without a handler by its event alone', () => {
    const text = formatText(
      { fresh: [unhandledFinding()], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: false },
    );

    expect(text.split('\n')[0]).toBe('error unhandled-event  RefundIssued  src/handlers.ts:4');
  });

  it('locates an undispatched buffer by owner and buffer', () => {
    const text = formatText({ fresh: [bufferFinding()], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' }, { showKnown: false });

    expect(text.split('\n')[0]).toBe('error undispatched-events  AggregateRoot._domainEvents  src/aggregate-root.ts:3');
  });

  it('names the aggregate by its class name', () => {
    const text = formatText(
      { fresh: [leakWith({ aggregateId: 'src/order.ts:Order' })], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: false },
    );

    expect(text).toContain('terminal-state-leak  Order.annotate()');
  });

  it('names a dead handler by its event and handler names', () => {
    const text = formatText(
      { fresh: [flowFinding({ details: { event: 'RefundIssued', eventId: 'src/events.ts:RefundIssued', handler: 'RefundHandler.handle', handlerClassId: 'src/handlers.ts:RefundHandler', handlerMethod: 'handle' } })], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: false },
    );

    expect(text).toContain('dead-handler  RefundIssued → RefundHandler.handle');
  });

  it('marks a new finding of a group over its baseline count', () => {
    const over = unhandledFinding();
    const text = formatText(
      { fresh: [over], known: [], exceeded: new Map([[over, { accepted: 1, found: 2 }]]), suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: appliedBaseline },
      { showKnown: false },
    );

    expect(text.split('\n')[0]).toMatch(/\(baseline accepts 1 of 2\)$/);
  });

  it('lists a stale entry by its described identity', () => {
    const text = formatText(
      { fresh: [], known: [], exceeded: new Map(), suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: { path: 'b.json', stale: [{ identity: identityOf(mutationFinding(), '/app'), accepted: 1, found: 0 }] } },
      { showKnown: false },
    );

    expect(text).toContain('  outside-mutation aggregate=src/order.ts:Order field=status file=src/mapper.ts scope=Mapper.reopen\n');
  });

  it('shows the counts of a reduced stale entry', () => {
    const text = formatText(
      { fresh: [], known: [], exceeded: new Map(), suppressed: [], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app', baseline: { path: 'b.json', stale: [{ identity: identityOf(unhandledFinding(), '/app'), accepted: 2, found: 1 }] } },
      { showKnown: false },
    );

    expect(text).toContain('  unhandled-event event=RefundIssued (accepts 2, found 1)\n');
  });
  const suppressedLeak = { finding: unreachableFinding(), reason: 'Seeded by a migration.' };
  const staleSuppression = { rule: 'terminal-state-leak' as const, classId: 'Order', target: 'Order', member: 'cancel', reason: 'R', source: 'domain.config.ts:7' };

  it('counts suppressed findings in the summary line', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [suppressedLeak], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: false },
    );

    expect(text).toBe('0 errors, 0 warnings, 1 suppressed in config\n');
  });

  it('lists suppressed findings with their reason when asked to show known findings', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [suppressedLeak], staleSuppressions: [], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: true },
    );

    expect(text).toContain('error unreachable-state  Order  src/order.ts:3 (suppressed: Seeded by a migration.)');
  });

  it('lists stale suppressions before the summary line', () => {
    const text = formatText(
      { fresh: [], exceeded: new Map(), known: [], suppressed: [], staleSuppressions: [staleSuppression], problems: [], rules: [], repositoryRoot: '/app' },
      { showKnown: false },
    );

    expect(text).toBe(
      ['1 stale suppression, matching no finding:', '  domain.config.ts:7 terminal-state-leak Order.cancel', '', '0 errors, 0 warnings', ''].join('\n'),
    );
  });
});
