import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif';
import { finding } from '../helpers/model';

describe('formatSarif', () => {
  it('produces a SARIF 2.1.0 run with rules and located results', () => {
    const parsed = JSON.parse(
      formatSarif({
        fresh: [finding({ severity: 'warning' })],
        known: [],
        problems: [],
        rules: [{ id: 'terminal-state-leak', description: 'D' }],
        root: '/app',
      }),
    );

    expect(parsed).toEqual({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'domain-integrity', rules: [{ id: 'terminal-state-leak', shortDescription: { text: 'D' } }] } },
          results: [
            {
              ruleId: 'terminal-state-leak',
              level: 'warning',
              message: { text: 'M1 Fix: F1' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'src/order.ts' }, region: { startLine: 10 } } }],
            },
          ],
        },
      ],
    });
  });
});
