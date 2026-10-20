import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { baselineKeys, partitionByBaseline, readBaseline, serializeBaseline, staleEntries } from '../../src/report/baseline';
import { bufferFinding, finding, leakWith, mismatchFinding, unhandledFinding } from '../helpers/model';

const tempFile = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'baseline-')), 'baseline.json');
  writeFileSync(path, content);
  return path;
};

describe('baseline', () => {
  it('round-trips findings by key, independent of line numbers', () => {
    const baseline = readBaseline(tempFile(serializeBaseline([finding({ line: 10 })])));

    expect(partitionByBaseline([finding({ line: 99 }), leakWith({ method: 'other' })], baseline)).toEqual({
      fresh: [leakWith({ method: 'other' })],
      known: [finding({ line: 99 })],
    });
  });

  it('rejects a missing baseline file with a usage error', () => {
    expect(() => readBaseline('/definitely/missing/baseline.json')).toThrow(UsageError);
  });

  it('rejects an unreadable baseline path with a read error', () => {
    expect(() => readBaseline(mkdtempSync(join(tmpdir(), 'baseline-dir-')))).toThrow(/Cannot read baseline/);
  });

  it('rejects a file that is not a baseline', () => {
    expect(() => readBaseline(tempFile('{"nope": true}'))).toThrow(UsageError);
  });

  it('rejects invalid JSON', () => {
    expect(() => readBaseline(tempFile('not json'))).toThrow(UsageError);
  });

  it('keys a finding by its aggregate id', () => {
    expect(JSON.parse(serializeBaseline([leakWith({ aggregateId: 'src/a/order.ts:Order' })])).findings).toEqual([
      'terminal-state-leak|src/a/order.ts:Order|annotate|status|CANCELLED',
    ]);
  });

  it('keys a finding of a uniquely named aggregate by its class name', () => {
    expect(JSON.parse(serializeBaseline([finding({})])).findings).toEqual(['terminal-state-leak|Order|annotate|status|CANCELLED']);
  });

  it('keys an event-flow finding by event, handler and declared ids', () => {
    expect(JSON.parse(serializeBaseline([mismatchFinding()])).findings).toEqual([
      'handler-payload-mismatch|RefundIssued|RefundHandler.handle|PaymentCaptured',
    ]);
  });

  it('keys an event-flow finding without a handler with an empty handler segment', () => {
    expect(JSON.parse(serializeBaseline([unhandledFinding()])).findings).toEqual([
      'unhandled-event|RefundIssued||',
    ]);
  });

  it('keys an undispatched buffer by owner and buffer', () => {
    expect(JSON.parse(serializeBaseline([bufferFinding()])).findings).toEqual(['undispatched-events|AggregateRoot|_domainEvents|']);
  });

  it('lists baseline keys once each, sorted', () => {
    expect(baselineKeys([leakWith({ method: 'zeta' }), leakWith({ method: 'alpha' }), leakWith({ method: 'zeta' }, { line: 40 })])).toEqual([
      'terminal-state-leak|Order|alpha|status|CANCELLED',
      'terminal-state-leak|Order|zeta|status|CANCELLED',
    ]);
  });

  it('reports baseline entries that match no finding as stale, sorted', () => {
    const baseline = new Set(['z|stale', 'terminal-state-leak|Order|annotate|status|CANCELLED', 'a|stale']);

    expect(staleEntries([finding({})], baseline)).toEqual(['a|stale', 'z|stale']);
  });

  it('reports no stale entries when every baseline entry matches a finding', () => {
    expect(staleEntries([finding({}), leakWith({ method: 'other' })], new Set(['terminal-state-leak|Order|annotate|status|CANCELLED']))).toEqual([]);
  });
});
