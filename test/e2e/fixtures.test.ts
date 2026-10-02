import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Finding } from '../../src/analyzer';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const checkJson = async (name: string) => {
  const { io, stdout } = captureIo(fixture(name));
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: Finding[] }).findings;
  return {
    code,
    findings: findings
      .map((finding) => `${finding.severity} ${finding.checkId} ${finding.aggregate}.${finding.method ?? '-'} ${finding.field} ${finding.subject}`)
      .sort(),
  };
};

const output = async (name: string, argv: string[]): Promise<string> => {
  const { io, stdout } = captureIo(fixture(name));
  await run(argv, io);
  return stdout();
};

describe('fixture projects', () => {
  it('enum-inline: leak, unreachable state and drift', async () => {
    expect(await checkJson('enum-inline')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Order.annotate status CANCELLED',
        'error transition-drift Order.cancel status extra',
        'error transition-drift Order.place status extra',
        'error unreachable-state Order.- status PAID',
        'warning transition-drift Order.place status missing',
      ],
    });
  });

  it('boolean-rule: leaks past a rule-object guard on another field', async () => {
    expect(await checkJson('boolean-rule')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Todo.complete deleted true',
        'error terminal-state-leak Todo.delete deleted true',
      ],
    });
  });

  it('nullable-timestamp: every method still runs after closing', async () => {
    expect(await checkJson('nullable-timestamp')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak Account.close closedAt set',
        'error terminal-state-leak Account.deposit closedAt set',
        'error terminal-state-leak Account.lock closedAt set',
        'error terminal-state-leak Account.withdraw closedAt set',
      ],
    });
  });

  it('outside-spec: state changed from a service and a specification', async () => {
    expect(await checkJson('outside-spec')).toEqual({
      code: 1,
      findings: [
        'error outside-mutation Invitation.- status InvitationService.accept',
        'error outside-mutation Invitation.- status WithStatus.mutate',
      ],
    });
  });

  it('enum-inline: text report', async () => {
    expect(await output('enum-inline', ['check'])).toMatchSnapshot();
  });

  it('enum-inline: diagram', async () => {
    expect(await output('enum-inline', ['show'])).toMatchSnapshot();
  });

  it('enum-inline: agent context', async () => {
    expect(await output('enum-inline', ['context'])).toMatchSnapshot();
  });
});
