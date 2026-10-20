import { describe, expect, it } from 'vitest';
import { sarifViolations } from '../helpers/sarif-structure';

const RULE = { id: 'dead-handler', defaultConfiguration: { level: 'error' } };

const LOCATION = { physicalLocation: { artifactLocation: { uri: 'src/handlers.ts' }, region: { startLine: 4 } } };

const RESULT = {
  ruleId: 'dead-handler',
  ruleIndex: 0,
  level: 'error',
  message: { text: 'M' },
  locations: [LOCATION],
  partialFingerprints: { 'domainIntegrity/v1': 'key' },
};

const logWith = (result: Readonly<Record<string, unknown>>) => ({
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'domain-integrity', rules: [RULE] } }, results: [result] }],
});

describe('sarifViolations', () => {
  it('accepts a well-formed log', () => {
    expect(sarifViolations(logWith(RESULT))).toEqual([]);
  });

  it('accepts an externally suppressed result', () => {
    expect(sarifViolations(logWith({ ...RESULT, suppressions: [{ kind: 'external' }] }))).toEqual([]);
  });

  it('rejects a log that is not SARIF 2.1.0', () => {
    expect(sarifViolations({ ...logWith(RESULT), version: '2.0.0' })).toEqual(['version is not 2.1.0']);
  });

  it('rejects a log without runs', () => {
    expect(sarifViolations({ version: '2.1.0', runs: [] })).toEqual(['runs is not a non-empty array']);
  });

  it('rejects a rule index that points past the rules', () => {
    expect(sarifViolations(logWith({ ...RESULT, ruleIndex: 1 }))).toEqual(['runs[0].results[0].ruleIndex does not point at the rule dead-handler']);
  });

  it('rejects a result without a rule index', () => {
    expect(sarifViolations(logWith({ ...RESULT, ruleIndex: undefined }))).toEqual(['runs[0].results[0].ruleIndex does not point at the rule dead-handler']);
  });

  it('rejects a rule id that names no rule', () => {
    expect(sarifViolations(logWith({ ...RESULT, ruleId: 'unknown-rule' }))).toEqual([
      'runs[0].results[0].ruleId names no rule',
      'runs[0].results[0].ruleIndex does not point at the rule unknown-rule',
    ]);
  });

  it('rejects a level that SARIF does not define', () => {
    expect(sarifViolations(logWith({ ...RESULT, level: 'fatal' }))).toEqual(['runs[0].results[0].level is not a SARIF level']);
  });

  it('rejects a fingerprint that is not a string', () => {
    expect(sarifViolations(logWith({ ...RESULT, partialFingerprints: { 'domainIntegrity/v1': 1 } }))).toEqual([
      'runs[0].results[0].partialFingerprints.domainIntegrity/v1 is not a string',
    ]);
  });

  it('rejects a suppression of an unknown kind', () => {
    expect(sarifViolations(logWith({ ...RESULT, suppressions: [{ kind: 'baseline' }] }))).toEqual([
      'runs[0].results[0].suppressions[0].kind is not a suppression kind',
    ]);
  });

  it('rejects an absolute location uri', () => {
    const absolute = { physicalLocation: { artifactLocation: { uri: '/app/src/handlers.ts' }, region: { startLine: 4 } } };

    expect(sarifViolations(logWith({ ...RESULT, locations: [absolute] }))).toEqual([
      'runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri is not a relative uri',
    ]);
  });

  it('rejects a location uri with backslashes', () => {
    const windows = { physicalLocation: { artifactLocation: { uri: 'src\\handlers.ts' }, region: { startLine: 4 } } };

    expect(sarifViolations(logWith({ ...RESULT, locations: [windows] }))).toEqual([
      'runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri is not a relative uri',
    ]);
  });

  it('rejects a start line below one', () => {
    const lineZero = { physicalLocation: { artifactLocation: { uri: 'src/handlers.ts' }, region: { startLine: 0 } } };

    expect(sarifViolations(logWith({ ...RESULT, locations: [lineZero] }))).toEqual([
      'runs[0].results[0].locations[0].physicalLocation.region.startLine is not a line number',
    ]);
  });

  it('rejects a rule id declared twice', () => {
    const log = { version: '2.1.0', runs: [{ tool: { driver: { name: 'domain-integrity', rules: [RULE, RULE] } }, results: [] }] };

    expect(sarifViolations(log)).toEqual(['runs[0].tool.driver.rules declares rule id dead-handler more than once']);
  });

  it('rejects a rule without a default level', () => {
    const log = { version: '2.1.0', runs: [{ tool: { driver: { name: 'domain-integrity', rules: [{ id: 'dead-handler' }] } }, results: [] }] };

    expect(sarifViolations(log)).toEqual(['runs[0].tool.driver.rules[0].defaultConfiguration.level is not a SARIF level']);
  });
});
