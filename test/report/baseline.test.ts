import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/engine/errors';
import { Finding, FindingOf } from '../../src/finding';
import { identityOf } from '../../src/report/identity';
import { parseBaseline, partitionByBaseline, readBaseline, serializeBaseline, staleEntries } from '../../src/report/baseline';
import { flowFinding, leakWith, mutationFinding, unhandledFinding } from '../helpers/model';

const ROOT = '/app';
const VERSION = '9.9.9';
const ENTRY = { rule: 'unhandled-event', event: 'src/e.ts:Shipped', count: 1 };

const fileWith = (findings: readonly unknown[], version: unknown = 2): string => JSON.stringify({ version, findings });
const parse = (content: string) => parseBaseline('b.json', content, VERSION);
const failure = (content: string): string => {
  try {
    parse(content);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  return 'did not throw';
};

const tempFile = (content: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'baseline-')), 'baseline.json');
  writeFileSync(path, content);
  return path;
};

const unhandled = (line = 4): FindingOf<'unhandled-event'> => ({ ...unhandledFinding(), line });
const deadHandlerWithoutHandler = (line: number): FindingOf<'dead-handler'> => {
  const base = flowFinding({ line });
  return { ...base, details: { ...base.details, handlerClassId: null, handlerMethod: null, handler: null } };
};
const baselineOf = (findings: readonly Finding[], counts: readonly number[]) =>
  parse(
    JSON.stringify({
      version: 2,
      findings: findings.map((finding, index) => ({ ...identityOf(finding, ROOT), count: counts[index] })),
    }),
  );

describe('baseline file', () => {
  it('rejects a missing baseline file with a usage error', () => {
    expect(() => readBaseline('/definitely/missing/baseline.json', VERSION)).toThrow(UsageError);
  });

  it('rejects an unreadable baseline path with a read error', () => {
    expect(() => readBaseline(mkdtempSync(join(tmpdir(), 'baseline-dir-')), VERSION)).toThrow(/Cannot read baseline/);
  });

  it('rejects invalid JSON', () => {
    expect(() => readBaseline(tempFile('not json'), VERSION)).toThrow('is not valid JSON.');
  });

  it('reads a written baseline from disk', () => {
    const baseline = readBaseline(tempFile(serializeBaseline([unhandled()], ROOT)), VERSION);

    expect([...baseline.values()].map((entry) => entry.count)).toEqual([1]);
  });
});

describe('parseBaseline', () => {
  it('rejects a version 1 baseline and tells how to regenerate it', () => {
    expect(failure(fileWith(['unhandled-event|Shipped||'], 1))).toBe(
      'Baseline b.json uses format version 1, which domain-integrity 9.9.9 no longer reads. Regenerate it with check --update-baseline; that accepts every current finding, so review the report first.',
    );
  });

  it('rejects a baseline without a version', () => {
    expect(failure(JSON.stringify({ findings: [] }))).toBe('Baseline b.json has format version none; this version reads 2.');
  });

  it('rejects a newer format version', () => {
    expect(failure(fileWith([], 3))).toBe('Baseline b.json has format version 3; this version reads 2.');
  });

  it('rejects a file without a findings array', () => {
    expect(failure(JSON.stringify({ version: 2 }))).toBe('Baseline b.json is not a domain-integrity baseline.');
  });

  it('rejects a file that is not an object', () => {
    expect(failure('[]')).toBe('Baseline b.json is not a domain-integrity baseline.');
  });

  it('rejects an entry that is not an object', () => {
    expect(failure(fileWith(['x']))).toBe('Baseline b.json entry 0: not an object.');
  });

  it('rejects an entry without a rule', () => {
    expect(failure(fileWith([{ count: 1 }]))).toBe('Baseline b.json entry 0: missing field "rule".');
  });

  it('rejects an unknown rule', () => {
    expect(failure(fileWith([{ rule: 'later-rule', count: 1 }]))).toBe('Baseline b.json entry 0: unknown rule "later-rule".');
  });

  it('rejects a missing field', () => {
    expect(failure(fileWith([{ rule: 'unhandled-event', count: 1 }]))).toBe('Baseline b.json entry 0: missing field "event".');
  });

  it('rejects a missing count', () => {
    expect(failure(fileWith([{ rule: 'unhandled-event', event: 'e' }]))).toBe('Baseline b.json entry 0: missing field "count".');
  });

  it('rejects an unexpected field', () => {
    expect(failure(fileWith([{ ...ENTRY, extra: 1 }]))).toBe('Baseline b.json entry 0: unexpected field "extra".');
  });

  it('rejects a string field of the wrong type', () => {
    expect(failure(fileWith([{ ...ENTRY, event: 3 }]))).toBe('Baseline b.json entry 0: field "event" must be a string.');
  });

  it('rejects a nullable field of the wrong type', () => {
    expect(failure(fileWith([{ rule: 'dead-handler', event: 'e', handlerClass: 3, handlerMethod: null, count: 1 }]))).toBe(
      'Baseline b.json entry 0: field "handlerClass" must be a string or null.',
    );
  });

  it('rejects a list field of the wrong type', () => {
    expect(
      failure(fileWith([{ rule: 'handler-payload-mismatch', event: 'e', handlerClass: null, handlerMethod: null, declared: 'A', count: 1 }])),
    ).toBe('Baseline b.json entry 0: field "declared" must be an array of strings.');
  });

  it.each([0, 1.5, '1', -2])('rejects the count %j as not a positive integer', (count) => {
    expect(failure(fileWith([{ ...ENTRY, count }]))).toBe('Baseline b.json entry 0: count must be a positive integer.');
  });

  it('rejects a repeated identity', () => {
    expect(failure(fileWith([ENTRY, ENTRY]))).toBe('Baseline b.json entry 1 repeats entry 0.');
  });

  it('reads an entry into its identity and count', () => {
    const baseline = parse(fileWith([{ ...ENTRY, count: 3 }]));

    expect([...baseline.values()]).toEqual([{ identity: { rule: 'unhandled-event', event: 'src/e.ts:Shipped' }, count: 3 }]);
  });
});

describe('serializeBaseline', () => {
  it('round-trips findings with their counts', () => {
    const baseline = parseBaseline('b.json', serializeBaseline([unhandled(), unhandled(9)], ROOT), VERSION);

    expect([...baseline.values()]).toEqual([{ identity: identityOf(unhandled(), ROOT), count: 2 }]);
  });

  it('writes entries in canonical order with count last', () => {
    const text = serializeBaseline([unhandledFinding(), mutationFinding()], ROOT);

    expect(text).toBe(
      `${JSON.stringify(
        {
          version: 2,
          findings: [
            { rule: 'outside-mutation', aggregate: 'src/order.ts:Order', field: 'status', file: 'src/mapper.ts', scope: 'Mapper.reopen', count: 1 },
            { rule: 'unhandled-event', event: 'RefundIssued', count: 1 },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it('groups findings that share an identity', () => {
    const parsed = JSON.parse(serializeBaseline([deadHandlerWithoutHandler(4), deadHandlerWithoutHandler(8)], ROOT));

    expect(parsed.findings).toEqual([{ rule: 'dead-handler', event: 'RefundIssued', handlerClass: null, handlerMethod: null, count: 2 }]);
  });
});

describe('partitionByBaseline', () => {
  it('treats every finding of a group within its count as known', () => {
    const [a, b] = [unhandled(4), unhandled(8)];

    expect(partitionByBaseline([a, b], baselineOf([a], [2]), ROOT)).toEqual({ fresh: [], known: [a, b], exceeded: new Map() });
  });

  it('treats every finding of a group over its count as new', () => {
    const [a, b] = [unhandled(4), unhandled(8)];

    expect(partitionByBaseline([a, b], baselineOf([a], [1]), ROOT)).toEqual({
      fresh: [a, b],
      known: [],
      exceeded: new Map([
        [a, { accepted: 1, found: 2 }],
        [b, { accepted: 1, found: 2 }],
      ]),
    });
  });

  it('treats findings without an entry as new without an excess', () => {
    const other = leakWith({ method: 'other' });

    expect(partitionByBaseline([other], baselineOf([unhandled()], [1]), ROOT)).toEqual({ fresh: [other], known: [], exceeded: new Map() });
  });

  it('matches findings independently of their line', () => {
    const result = partitionByBaseline([unhandled(99)], baselineOf([unhandled(1)], [1]), ROOT);

    expect(result.known).toHaveLength(1);
  });

  it('keeps the input order of fresh and known findings', () => {
    const [a, b, c] = [unhandled(), leakWith({ method: 'x' }), mutationFinding()];

    const result = partitionByBaseline([a, b, c], baselineOf([b], [1]), ROOT);

    expect([result.fresh, result.known]).toEqual([[a, c], [b]]);
  });
});

describe('staleEntries', () => {
  it('reports an entry with no current finding as stale', () => {
    const baseline = baselineOf([unhandled()], [1]);

    expect(staleEntries([], baseline, ROOT)).toEqual([{ identity: identityOf(unhandled(), ROOT), accepted: 1, found: 0 }]);
  });

  it('reports an entry whose count exceeds the findings as stale', () => {
    const baseline = baselineOf([unhandled()], [2]);

    expect(staleEntries([unhandled()], baseline, ROOT)).toEqual([{ identity: identityOf(unhandled(), ROOT), accepted: 2, found: 1 }]);
  });

  it('reports no stale entries when every entry is fully used', () => {
    expect(staleEntries([unhandled()], baselineOf([unhandled()], [1]), ROOT)).toEqual([]);
  });

  it('orders stale entries by identity', () => {
    const baseline = baselineOf([unhandled(), mutationFinding()], [1, 1]);

    expect(staleEntries([], baseline, ROOT).map((entry) => entry.identity.rule)).toEqual(['outside-mutation', 'unhandled-event']);
  });
});
