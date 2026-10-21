import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json';
import { Problem } from '../../src/finding';
import { Report } from '../../src/report/text';
import { TOOL, bufferFinding, finding, flowFinding, missingFinding } from '../helpers/model';

const MISSING_FIELD: Problem = {
  code: 'state-field-missing',
  analyzer: 'lifecycle',
  message: 'Order has no field "state"',
  details: { aggregate: 'Order', field: 'state' },
};

const report = (overrides: Partial<Report> = {}): Report => ({ fresh: [], known: [], problems: [], rules: [], repositoryRoot: '/app', ...overrides });

const parse = (overrides: Partial<Report> = {}) => JSON.parse(formatJson(report(overrides), TOOL));

describe('formatJson', () => {
  it('orders the top-level keys', () => {
    expect(Object.keys(parse())).toEqual(['version', 'tool', 'summary', 'findings', 'known', 'problems']);
  });

  it('carries format version 1', () => {
    expect(parse().version).toBe(1);
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

  it('writes a finding through the envelope with a relative location and its key', () => {
    expect(parse({ fresh: [finding()] }).findings).toEqual([
      {
        ruleId: 'terminal-state-leak',
        severity: 'error',
        analyzer: 'lifecycle',
        key: 'terminal-state-leak|Order|annotate|status|CANCELLED',
        location: { file: 'src/order.ts', line: 10 },
        message: 'M1',
        fix: 'F1',
        details: { aggregate: 'Order', aggregateId: 'Order', method: 'annotate', field: 'status', values: ['CANCELLED'] },
      },
    ]);
  });

  it('orders the keys of a finding', () => {
    expect(Object.keys(parse({ fresh: [finding()] }).findings[0])).toEqual(['ruleId', 'severity', 'analyzer', 'key', 'location', 'message', 'fix', 'details']);
  });

  it('writes an absent handler as null', () => {
    const details = parse({ fresh: [flowFinding({ details: { event: 'RefundIssued', eventId: 'RefundIssued', handler: null, handlerClassId: null, handlerMethod: null } })] }).findings[0].details;

    expect(details).toEqual({ event: 'RefundIssued', eventId: 'RefundIssued', handler: null });
  });

  it('writes known findings through the same envelope', () => {
    expect(parse({ known: [bufferFinding()] }).known[0].key).toBe('undispatched-events|AggregateRoot|_domainEvents|');
  });

  it('keeps an extra property of a finding\'s details off the wire', () => {
    const details = { ...finding().details, leaked: 'x' };

    expect(parse({ fresh: [finding({ details })] }).findings[0].details).not.toHaveProperty('leaked');
  });

  it('writes a finding\'s details in the documented order whatever the order they were built in', () => {
    const { values, field, method, aggregateId, aggregate } = finding().details;

    const reversed = parse({ fresh: [finding({ details: { values, field, method, aggregateId, aggregate } })] }).findings[0].details;

    expect(Object.keys(reversed)).toEqual(['aggregate', 'aggregateId', 'method', 'field', 'values']);
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
