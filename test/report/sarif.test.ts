import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/report/sarif';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks';
import { RuleDescription } from '../../src/analyzer';
import { ToolIdentity } from '../../src/report/tool';
import { TOOL, bufferFinding, finding } from '../helpers/model';

const UNDISPATCHED_RULE = EVENT_FLOW_RULES.filter((rule) => rule.id === 'undispatched-events');

type SarifDriver = { readonly name: string; readonly version: string; readonly informationUri: string; readonly rules: unknown };

type SarifRun = { readonly tool: { readonly driver: SarifDriver }; readonly results: unknown };

const undispatchedRun = (): SarifRun =>
  JSON.parse(formatSarif({ fresh: [bufferFinding()], known: [], problems: [], rules: UNDISPATCHED_RULE, root: '/app' }, TOOL)).runs[0];

const WARNING_RULE: RuleDescription = { id: 'transition-drift', severity: 'warning', description: 'D', explanation: 'E', remedy: 'R' };

const ERROR_RULE: RuleDescription = { id: 'terminal-state-leak', severity: 'error', description: 'D', explanation: 'E', remedy: 'R' };

const DOCUMENTED_TOOL: ToolIdentity = { name: 'domain-integrity', version: '1.2.3', informationUri: 'https://example.test/docs#readme' };

const UNDOCUMENTED_TOOL: ToolIdentity = { name: 'domain-integrity', version: '1.2.3' };

const sarifRules = (rules: readonly RuleDescription[], tool: ToolIdentity) =>
  JSON.parse(formatSarif({ fresh: [], known: [], problems: [], rules, root: '/app' }, tool)).runs[0].tool.driver.rules;

const sarifRuleOf = (rule: RuleDescription, tool: ToolIdentity) => sarifRules([rule], tool)[0];

describe('formatSarif', () => {
  it('produces a SARIF 2.1.0 run with rules and located results', () => {
    const parsed = JSON.parse(
      formatSarif({
        fresh: [finding({ severity: 'warning' })],
        known: [],
        problems: [],
        rules: [{ id: 'terminal-state-leak', severity: 'error', description: 'D', explanation: 'E', remedy: 'R' }],
        root: '/app',
      }, TOOL),
    );

    expect(parsed).toEqual({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'domain-integrity', version: '1.2.3', informationUri: 'https://example.test', rules: [
                {
                  id: 'terminal-state-leak',
                  shortDescription: { text: 'D' },
                  fullDescription: { text: 'E' },
                  help: { text: 'R', markdown: 'R\n\n[Rule reference](https://example.test/#terminal-state-leak)' },
                  helpUri: 'https://example.test/#terminal-state-leak',
                  defaultConfiguration: { level: 'error' },
                },
              ],
            },
          },
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

  it('leaves out the information uri when the tool has none', () => {
    const driver = JSON.parse(formatSarif({ fresh: [], known: [], problems: [], rules: [], root: '/app' }, { name: 'domain-integrity', version: '1.2.3' })).runs[0].tool.driver;

    expect('informationUri' in driver).toBe(false);
  });

  it('declares the undispatched-events rule with its description', () => {
    const [rule] = UNDISPATCHED_RULE;

    expect(undispatchedRun().tool.driver.rules).toEqual([
      {
        id: 'undispatched-events',
        shortDescription: { text: 'An event method stores events in a buffer that production code never reads or drains.' },
        fullDescription: { text: rule?.explanation },
        help: { text: rule?.remedy, markdown: `${rule?.remedy}\n\n[Rule reference](https://example.test/#undispatched-events)` },
        helpUri: 'https://example.test/#undispatched-events',
        defaultConfiguration: { level: 'error' },
      },
    ]);
  });

  it('describes a rule in full with its explanation', () => {
    expect(sarifRuleOf(ERROR_RULE, DOCUMENTED_TOOL).fullDescription).toEqual({ text: 'E' });
  });

  it('gives a rule its remedy as help text', () => {
    expect(sarifRuleOf(ERROR_RULE, DOCUMENTED_TOOL).help.text).toBe('R');
  });

  it('links the remedy to the rule reference in the help markdown', () => {
    expect(sarifRuleOf(ERROR_RULE, DOCUMENTED_TOOL).help.markdown).toBe('R\n\n[Rule reference](https://example.test/docs#terminal-state-leak)');
  });

  it('points the help uri at the rule id in place of the information uri fragment', () => {
    expect(sarifRuleOf(ERROR_RULE, DOCUMENTED_TOOL).helpUri).toBe('https://example.test/docs#terminal-state-leak');
  });

  it('leaves out the help uri when the tool has no information uri', () => {
    expect('helpUri' in sarifRuleOf(ERROR_RULE, UNDOCUMENTED_TOOL)).toBe(false);
  });

  it('gives the help markdown only the remedy when the tool has no information uri', () => {
    expect(sarifRuleOf(ERROR_RULE, UNDOCUMENTED_TOOL).help.markdown).toBe('R');
  });

  it('sets the default level of each rule from its severity', () => {
    const levels = sarifRules([WARNING_RULE, ERROR_RULE], DOCUMENTED_TOOL).map(
      (rule: { readonly defaultConfiguration: unknown }) => rule.defaultConfiguration,
    );

    expect(levels).toEqual([{ level: 'warning' }, { level: 'error' }]);
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
