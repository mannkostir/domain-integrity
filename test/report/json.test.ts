import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json';
import { Problem } from '../../src/finding';
import { identityOf } from '../../src/report/identity';
import { Report } from '../../src/report/text';
import { TOOL, bufferFinding, driftFinding, finding, flowFinding, mismatchFinding, missingFinding, mutationFinding, sagaFinding, unhandledFinding, unreachableFinding } from '../helpers/model';

const MISSING_FIELD: Problem = {
  code: 'state-field-missing',
  analyzer: 'lifecycle',
  message: 'Order has no field "state"',
  details: { aggregate: 'Order', field: 'state' },
};

const report = (overrides: Partial<Report> = {}): Report => ({ fresh: [], known: [], exceeded: new Map(), problems: [], rules: [], repositoryRoot: '/app', ...overrides });

const parse = (overrides: Partial<Report> = {}) => JSON.parse(formatJson(report(overrides), TOOL));

describe('formatJson', () => {
  it('orders the top-level keys', () => {
    expect(Object.keys(parse())).toEqual(['version', 'tool', 'summary', 'findings', 'known', 'problems']);
  });

  it('carries format version 2', () => {
    expect(parse().version).toBe(2);
  });

  it('names the tool and its version', () => {
    expect(parse().tool).toEqual({ name: 'domain-integrity', version: '1.2.3' });
  });

  it('writes problems with their code, analyzer, message and details in order', () => {
    const [problem] = parse({ problems: [MISSING_FIELD] }).problems;

    expect([Object.keys(problem), problem]).toEqual([['code', 'analyzer', 'message', 'details'], MISSING_FIELD]);
  });

  it('counts new errors and warnings, known findings and problems', () => {
    expect(parse({ fresh: [finding(), missingFinding()], known: [bufferFinding()], problems: [MISSING_FIELD] }).summary).toEqual({ errors: 1, warnings: 1, known: 1, problems: 1 });
  });

  it('writes a finding through the envelope with a relative location and its identity', () => {
    expect(parse({ fresh: [finding()] }).findings).toEqual([
      {
        ruleId: 'terminal-state-leak',
        severity: 'error',
        analyzer: 'lifecycle',
        identity: { rule: 'terminal-state-leak', aggregate: 'Order', method: 'annotate', field: 'status', values: ['CANCELLED'] },
        location: { file: 'src/order.ts', line: 10 },
        message: 'M1',
        fix: 'F1',
        details: { aggregate: 'Order', method: 'annotate', field: 'status', values: ['CANCELLED'] },
      },
    ]);
  });

  it('orders the finding keys with identity in place of key', () => {
    expect(Object.keys(parse({ fresh: [finding()] }).findings[0])).toEqual(['ruleId', 'severity', 'analyzer', 'identity', 'location', 'message', 'fix', 'details']);
  });

  it('carries the finding identity', () => {
    expect(parse({ fresh: [mutationFinding()] }).findings[0].identity).toEqual(identityOf(mutationFinding(), '/app'));
  });

  it('locates the finding relative to the repository root', () => {
    expect(parse({ fresh: [mutationFinding()], repositoryRoot: '/app/src' }).findings[0].location.file).toBe('mapper.ts');
  });

  it.each([
    ['terminal-state-leak', finding()],
    ['unreachable-state', unreachableFinding()],
    ['outside-mutation', mutationFinding()],
    ['transition-drift', driftFinding()],
    ['transition-missing', missingFinding()],
    ['dead-handler', flowFinding()],
    ['handler-payload-mismatch', mismatchFinding()],
    ['unhandled-event', unhandledFinding()],
    ['saga-missing-failure-path', sagaFinding()],
    ['undispatched-events', bufferFinding()],
  ] as const)('leaves ids out of the details of %s', (_rule, sample) => {
    const keys = Object.keys(parse({ fresh: [sample] }).findings[0].details);

    expect(keys.filter((key) => ['aggregateId', 'eventId', 'sagaId', 'successId', 'failureId', 'ownerId', 'declaredIds', 'handlerClassId', 'handlerMethod'].includes(key))).toEqual([]);
  });

  it('writes an absent handler as null', () => {
    const details = parse({ fresh: [flowFinding({ details: { event: 'RefundIssued', eventId: 'RefundIssued', handler: null, handlerClassId: null, handlerMethod: null } })] }).findings[0].details;

    expect(details).toEqual({ event: 'RefundIssued', handler: null });
  });

  it('writes known findings through the same envelope', () => {
    expect(parse({ known: [bufferFinding()] }).known[0].identity).toEqual({ rule: 'undispatched-events', owner: 'AggregateRoot', buffer: '_domainEvents' });
  });

  it('keeps an extra property of a finding\'s details off the wire', () => {
    const details = { ...finding().details, leaked: 'x' };

    expect(parse({ fresh: [finding({ details })] }).findings[0].details).not.toHaveProperty('leaked');
  });

  it('writes a finding\'s details in the documented order whatever the order they were built in', () => {
    const { values, field, method, aggregate } = finding().details;

    const reversed = parse({ fresh: [finding({ details: { values, field, method, aggregateId: 'Order', aggregate } })] }).findings[0].details;

    expect(Object.keys(reversed)).toEqual(['aggregate', 'method', 'field', 'values']);
  });

  it('keeps an extra property of a problem\'s details off the wire', () => {
    const details = { ...MISSING_FIELD.details, leaked: 'x' };

    expect(parse({ problems: [{ ...MISSING_FIELD, details }] }).problems[0].details).not.toHaveProperty('leaked');
  });

  it('writes a problem\'s details in the documented order whatever the order they were built in', () => {
    const problem: Problem = { code: 'unknown-state-value', analyzer: 'lifecycle', message: 'M', details: { known: ['A'], value: 'B', field: 'status', aggregate: 'Order' } };

    expect(Object.keys(parse({ problems: [problem] }).problems[0].details)).toEqual(['aggregate', 'field', 'value', 'known']);
  });
});
