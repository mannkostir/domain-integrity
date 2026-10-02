import { describe, expect, it } from 'vitest';
import { formatJson } from '../../src/report/json';
import { finding } from '../helpers/model';

describe('formatJson', () => {
  it('writes findings with paths relative to the root', () => {
    const parsed = JSON.parse(formatJson({ fresh: [finding({})], known: [], problems: ['p'], rules: [], root: '/app' }));

    expect(parsed).toEqual({ findings: [{ ...finding({}), file: 'src/order.ts' }], known: [], problems: ['p'] });
  });
});
