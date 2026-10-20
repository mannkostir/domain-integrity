import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json';
import { TOOL, bufferFinding, finding } from '../helpers/model';

describe('formatJson', () => {
  it('writes findings with paths relative to the root', () => {
    const { findings, known, problems } = JSON.parse(formatJson({ fresh: [finding({})], known: [], problems: ['p'], rules: [], root: '/app' }, TOOL));

    expect({ findings, known, problems }).toEqual({ findings: [{ ...finding({}), file: 'src/order.ts' }], known: [], problems: ['p'] });
  });

  it('names the tool and its version', () => {
    const parsed = JSON.parse(formatJson({ fresh: [], known: [], problems: [], rules: [], root: '/app' }, TOOL));

    expect(parsed.tool).toEqual({ name: 'domain-integrity', version: '1.2.3' });
  });

  it('tags lifecycle findings with their analyzer', () => {
    const parsed = JSON.parse(formatJson({ fresh: [finding({})], known: [], problems: [], rules: [], root: '/app' }, TOOL));

    expect(parsed.findings[0].analyzer).toBe('lifecycle');
  });

  it('serialises the buffer fields of an undispatched-events finding', () => {
    const parsed = JSON.parse(formatJson({ fresh: [bufferFinding()], known: [], problems: [], rules: [], root: '/app' }, TOOL));

    expect(parsed.findings[0].details).toMatchObject({
      owner: 'AggregateRoot',
      ownerId: 'AggregateRoot',
      buffer: '_domainEvents',
      method: 'addDomainEvent',
      raisers: ['Booking', 'Payment'],
    });
  });
});
