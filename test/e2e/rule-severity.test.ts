import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Finding, Severity } from '../../src/analyzer';
import { EVENT_FLOW_RULES } from '../../src/analyzers/event-flow/checks/rules';
import { LIFECYCLE_RULES } from '../../src/analyzers/lifecycle/checks/rules';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

const RULE_SEVERITY: ReadonlyMap<string, Severity> = new Map(
  [...LIFECYCLE_RULES, ...EVENT_FLOW_RULES].map((rule) => [rule.id, rule.severity]),
);

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const reportedFindings = async (name: string): Promise<readonly Finding[]> => {
  const { io, stdout } = captureIo(fixture(name));
  await run(['check', '--format', 'json'], io);
  return (JSON.parse(stdout()) as { findings: Finding[] }).findings;
};

const severities = (findings: readonly Finding[]) => findings.map(({ checkId, severity }) => ({ checkId, severity }));

const ruleSeverities = (findings: readonly Finding[]) =>
  findings.map(({ checkId }) => ({ checkId, severity: RULE_SEVERITY.get(checkId) }));

describe('finding severity', () => {
  it('matches the rule of each lifecycle finding', async () => {
    const findings = await reportedFindings('enum-inline');

    expect(severities(findings)).toEqual(ruleSeverities(findings));
  });

  it('matches the rule of each event-flow finding', async () => {
    const findings = await reportedFindings('event-flows');

    expect(severities(findings)).toEqual(ruleSeverities(findings));
  });
});
