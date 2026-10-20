import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks';
import { TOOL, bufferFinding, finding } from '../helpers/model';

const UNDISPATCHED_RULE = EVENT_FLOW_RULES.filter((rule) => rule.id === 'undispatched-events');

type SarifDriver = { readonly name: string; readonly version: string; readonly informationUri: string; readonly rules: unknown };

type SarifRun = { readonly tool: { readonly driver: SarifDriver }; readonly results: unknown };

const undispatchedRun = (): SarifRun =>
  JSON.parse(formatSarif({ fresh: [bufferFinding()], known: [], problems: [], rules: UNDISPATCHED_RULE, root: '/app' }, TOOL)).runs[0];

describe('formatSarif', () => {
  it('produces a SARIF 2.1.0 run with rules and located results', () => {
    const parsed = JSON.parse(
      formatSarif({
        fresh: [finding({ severity: 'warning' })],
        known: [],
        problems: [],
        rules: [{ id: 'terminal-state-leak', description: 'D' }],
        root: '/app',
      }, TOOL),
    );

    expect(parsed).toEqual({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'domain-integrity', version: '1.2.3', informationUri: 'https://example.test', rules: [{ id: 'terminal-state-leak', shortDescription: { text: 'D' } }] } },
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

  it('identifies the driver by version and information uri', () => {
    const { version, informationUri } = undispatchedRun().tool.driver;

    expect({ version, informationUri }).toEqual({ version: '1.2.3', informationUri: 'https://example.test' });
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
