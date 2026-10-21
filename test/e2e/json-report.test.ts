import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { RuleId } from '../../src/finding';
import { captureIo } from '../helpers/disk';
import { JSON_FIXTURES } from '../helpers/fixtures';

const DETAIL_KEYS: Readonly<Record<RuleId, readonly string[]>> = {
  'terminal-state-leak': ['aggregate', 'method', 'field', 'values'],
  'unreachable-state': ['aggregate', 'field', 'value'],
  'outside-mutation': ['aggregate', 'field', 'scope'],
  'transition-drift': ['aggregate', 'method', 'field', 'kind', 'values'],
  'transition-missing': ['aggregate', 'method', 'field', 'values'],
  'dead-handler': ['event', 'handler'],
  'handler-payload-mismatch': ['event', 'handler', 'declared'],
  'unhandled-event': ['event'],
  'saga-missing-failure-path': ['saga', 'success', 'failure'],
  'undispatched-events': ['owner', 'buffer', 'method', 'raisers'],
};

type WireFinding = { readonly ruleId: RuleId; readonly identity: unknown; readonly details: Readonly<Record<string, unknown>> };

const findingsOf = async (name: string): Promise<readonly WireFinding[]> => {
  const { io, stdout } = captureIo(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
  await run(['check', '--format', 'json'], io);
  return (JSON.parse(stdout()) as { findings: WireFinding[] }).findings;
};

const fixtureFindings = async (): Promise<readonly WireFinding[]> => (await Promise.all(JSON_FIXTURES.map(findingsOf))).flat();

describe('JSON report details', () => {
  it('exercises every rule across the fixtures', async () => {
    const ruleIds = new Set((await fixtureFindings()).map((finding) => finding.ruleId));

    expect(ruleIds).toEqual(new Set(Object.keys(DETAIL_KEYS)));
  });

  it('writes each finding\'s details in the documented order', async () => {
    const findings = await fixtureFindings();

    findings.forEach((finding) => expect([finding.ruleId, Object.keys(finding.details)]).toEqual([finding.ruleId, DETAIL_KEYS[finding.ruleId]]));
  });

  it('names undispatched raisers by display name rather than id', async () => {
    const raisers = (await fixtureFindings()).filter((finding) => finding.ruleId === 'undispatched-events').flatMap((finding) => finding.details.raisers as readonly string[]);

    expect(raisers.filter((raiser) => raiser.includes(':'))).toEqual([]);
  });

  it('writes an identity on every finding', async () => {
    const findings = await fixtureFindings();

    expect(findings.filter((finding) => typeof finding.identity !== 'object')).toEqual([]);
  });

  it('writes no key on any finding', async () => {
    const findings = await fixtureFindings();

    expect(findings.filter((finding) => 'key' in finding)).toEqual([]);
  });
});
