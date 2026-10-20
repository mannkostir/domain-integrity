import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { RuleId } from '../../src/finding';
import { captureIo } from '../helpers/disk';

const DETAIL_KEYS: Readonly<Record<RuleId, readonly string[]>> = {
  'terminal-state-leak': ['aggregate', 'aggregateId', 'method', 'field', 'values'],
  'unreachable-state': ['aggregate', 'aggregateId', 'field', 'value'],
  'outside-mutation': ['aggregate', 'aggregateId', 'field', 'scope'],
  'transition-drift': ['aggregate', 'aggregateId', 'method', 'field', 'kind', 'values'],
  'transition-missing': ['aggregate', 'aggregateId', 'method', 'field', 'values'],
  'dead-handler': ['event', 'eventId', 'handler'],
  'handler-payload-mismatch': ['event', 'eventId', 'handler', 'declared', 'declaredIds'],
  'unhandled-event': ['event', 'eventId'],
  'saga-missing-failure-path': ['saga', 'sagaId', 'success', 'successId', 'failure', 'failureId'],
  'undispatched-events': ['owner', 'ownerId', 'buffer', 'method', 'raisers'],
};

const FIXTURES = ['enum-inline', 'boolean-rule', 'nullable-timestamp', 'event-flows', 'outside-spec', 'nx-monorepo'];

type WireFinding = { readonly ruleId: RuleId; readonly details: Readonly<Record<string, unknown>> };

const findingsOf = async (name: string): Promise<readonly WireFinding[]> => {
  const { io, stdout } = captureIo(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
  await run(['check', '--format', 'json'], io);
  return (JSON.parse(stdout()) as { findings: WireFinding[] }).findings;
};

const fixtureFindings = async (): Promise<readonly WireFinding[]> => (await Promise.all(FIXTURES.map(findingsOf))).flat();

describe('JSON report details', () => {
  it('exercises every rule across the fixtures', async () => {
    const ruleIds = new Set((await fixtureFindings()).map((finding) => finding.ruleId));

    expect(ruleIds).toEqual(new Set(Object.keys(DETAIL_KEYS)));
  });

  it('writes each finding\'s details in the documented order', async () => {
    const findings = await fixtureFindings();

    findings.forEach((finding) => expect([finding.ruleId, Object.keys(finding.details)]).toEqual([finding.ruleId, DETAIL_KEYS[finding.ruleId]]));
  });
});
