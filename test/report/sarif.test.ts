import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks';
import { bufferFinding, finding } from '../helpers/model';

const UNDISPATCHED_RULE = EVENT_FLOW_RULES.filter((rule) => rule.id === 'undispatched-events');

type SarifRun = { readonly tool: { readonly driver: { readonly rules: unknown } }; readonly results: unknown };

const undispatchedRun = (): SarifRun =>
  JSON.parse(formatSarif({ fresh: [bufferFinding()], known: [], problems: [], rules: UNDISPATCHED_RULE, root: '/app' })).runs[0];

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

  it('declares the undispatched-events rule with its description', () => {
    expect(undispatchedRun().tool.driver.rules).toEqual([
      { id: 'undispatched-events', shortDescription: { text: 'An event method stores events in a buffer that production code never reads or drains.' } },
    ]);
  });

  it('reports an undispatched-events finding under its rule at the buffer location', () => {
    expect(undispatchedRun().results).toEqual([
      {
        ruleId: 'undispatched-events',
        level: 'error',
        message: { text: 'M4 Fix: F4' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/aggregate-root.ts' }, region: { startLine: 3 } } }],
      },
    ]);
  });
});
