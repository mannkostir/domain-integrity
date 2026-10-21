import { describe, expect, it } from 'vitest';
import { FINGERPRINT, formatSarif } from '../../src/report/sarif';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks';
import { RuleDescription } from '../../src/analyzer';
import { Finding } from '../../src/finding';
import { identityOf, serializeIdentity } from '../../src/report/identity';
import { ToolIdentity } from '../../src/report/tool';
import { TOOL, bufferFinding, finding, flowFinding, missingFinding, unhandledFinding } from '../helpers/model';
import { SarifResult, SarifRule, SarifRun, parseSarif } from '../helpers/sarif-log';
import { sarifViolations } from '../helpers/sarif-structure';
import { ALL_RULES } from '../helpers/rules';

const UNDISPATCHED_RULE = EVENT_FLOW_RULES.filter((rule) => rule.id === 'undispatched-events');

const WARNING_RULE: RuleDescription = { id: 'transition-drift', severity: 'warning', description: 'D', explanation: 'E', remedy: 'R' };

const ERROR_RULE: RuleDescription = { id: 'terminal-state-leak', severity: 'error', description: 'D', explanation: 'E', remedy: 'R' };

const DOCUMENTED_TOOL: ToolIdentity = { name: 'domain-integrity', version: '1.2.3', informationUri: 'https://example.test/docs#readme' };

const UNDOCUMENTED_TOOL: ToolIdentity = { name: 'domain-integrity', version: '1.2.3' };

const sarifRun = (fresh: readonly Finding[], rules: readonly RuleDescription[], tool: ToolIdentity = TOOL, known: readonly Finding[] = []): SarifRun => {
  const [run] = parseSarif(formatSarif({ fresh, known, problems: [], rules, repositoryRoot: '/app', exceeded: new Map() }, tool)).runs;
  if (run === undefined) throw new Error('The SARIF log has no run.');
  return run;
};

const undispatchedRun = (): SarifRun => sarifRun([bufferFinding()], UNDISPATCHED_RULE);

const sarifRules = (rules: readonly RuleDescription[], tool: ToolIdentity): readonly SarifRule[] => sarifRun([], rules, tool).tool.driver.rules;

const sarifRuleOf = (rule: RuleDescription, tool: ToolIdentity): SarifRule => {
  const [described] = sarifRules([rule], tool);
  if (described === undefined) throw new Error(`The SARIF driver does not describe ${rule.id}.`);
  return described;
};

const onlyResult = (run: SarifRun): SarifResult => {
  const [result] = run.results;
  if (result === undefined) throw new Error('The SARIF run has no result.');
  return result;
};

const leakResult = (): SarifResult => onlyResult(sarifRun([finding({})], [WARNING_RULE, ERROR_RULE]));

const knownLeakResult = (): SarifResult => onlyResult(sarifRun([], [ERROR_RULE], TOOL, [finding({})]));

describe('formatSarif', () => {
  it('produces a SARIF 2.1.0 log of one run', () => {
    const log = parseSarif(formatSarif({ fresh: [], known: [], exceeded: new Map(), problems: [], rules: [], repositoryRoot: '/app' }, TOOL));

    expect({ $schema: log.$schema, version: log.version, runs: log.runs.length }).toEqual({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: 1,
    });
  });

  it('names the driver after the tool', () => {
    expect(undispatchedRun().tool.driver.name).toBe('domain-integrity');
  });

  it('identifies the driver by version and information uri', () => {
    const { version, informationUri } = undispatchedRun().tool.driver;

    expect({ version, informationUri }).toEqual({ version: '1.2.3', informationUri: 'https://example.test' });
  });

  it('leaves out the information uri when the tool has none', () => {
    const { driver } = sarifRun([], [], UNDOCUMENTED_TOOL).tool;

    expect('informationUri' in driver).toBe(false);
  });

  it('declares the undispatched-events rule with its description', () => {
    const rules = undispatchedRun().tool.driver.rules.map(({ id, shortDescription }) => ({ id, shortDescription }));

    expect(rules).toEqual([
      { id: 'undispatched-events', shortDescription: { text: 'An event method stores events in a buffer that production code never reads or drains.' } },
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
    const levels = sarifRules([WARNING_RULE, ERROR_RULE], DOCUMENTED_TOOL).map((rule) => rule.defaultConfiguration);

    expect(levels).toEqual([{ level: 'warning' }, { level: 'error' }]);
  });

  it('reports a result at the level of its finding', () => {
    expect(onlyResult(sarifRun([finding({ severity: 'warning' })], [ERROR_RULE])).level).toBe('warning');
  });

  it('points a result at the index of its rule in the driver', () => {
    expect(leakResult().ruleIndex).toBe(1);
  });

  it('reports the finding message without the fix', () => {
    expect(leakResult().message).toEqual({ text: 'M1' });
  });

  it('carries the fix as a result property', () => {
    expect(leakResult().properties).toEqual({ fix: 'F1' });
  });

  it('fingerprints a result with its serialized identity under domainIntegrity/v2', () => {
    expect(leakResult().partialFingerprints).toEqual({ 'domainIntegrity/v2': serializeIdentity(identityOf(finding({}), '/app')) });
  });

  it('locates a result relative to the repository root with the %SRCROOT% base', () => {
    expect(leakResult().locations[0]?.physicalLocation.artifactLocation).toEqual({ uri: 'src/order.ts', uriBaseId: '%SRCROOT%' });
  });

  it('leaves a fresh result unsuppressed', () => {
    expect('suppressions' in leakResult()).toBe(false);
  });

  it('reports known findings after the fresh ones', () => {
    const run = sarifRun([finding({})], [ERROR_RULE], TOOL, [finding({ message: 'M2' })]);

    expect(run.results.map((result) => result.message.text)).toEqual(['M1', 'M2']);
  });

  it('suppresses a known finding as recorded outside the source', () => {
    expect(knownLeakResult().suppressions).toEqual([{ kind: 'external', justification: 'Recorded in the domain-integrity baseline.' }]);
  });

  it('fingerprints a known finding like a fresh one', () => {
    expect(knownLeakResult().partialFingerprints).toEqual({ 'domainIntegrity/v2': serializeIdentity(identityOf(finding({}), '/app')) });
  });

  it('refuses a finding whose rule the report does not declare', () => {
    expect(() => sarifRun([bufferFinding()], [ERROR_RULE])).toThrow('undispatched-events');
  });

  it('reports an undispatched-events finding under its rule at the buffer location', () => {
    expect(undispatchedRun().results).toEqual([
      {
        ruleId: 'undispatched-events',
        ruleIndex: 0,
        level: 'error',
        message: { text: 'M4' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/aggregate-root.ts', uriBaseId: '%SRCROOT%' }, region: { startLine: 3 } } }],
        partialFingerprints: { [FINGERPRINT]: serializeIdentity(identityOf(bufferFinding(), '/app')) },
        properties: { fix: 'F4' },
      },
    ]);
  });

  it('produces a structurally valid log for fresh and known findings of both analyzers', () => {
    const report = {
      fresh: [finding({}), bufferFinding(), flowFinding({})],
      known: [missingFinding(), unhandledFinding()],
      problems: [],
      rules: ALL_RULES,
      repositoryRoot: '/app',
      exceeded: new Map(),
    };

    expect(sarifViolations(JSON.parse(formatSarif(report, TOOL)))).toEqual([]);
  });
});
