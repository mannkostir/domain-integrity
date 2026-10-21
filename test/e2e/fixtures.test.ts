import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { captureIo } from '../helpers/disk';

type SarifRun = { readonly tool: { readonly driver: Readonly<Record<string, unknown>> } };

type SarifLog = { readonly runs: readonly [SarifRun, ...SarifRun[]] };

const withoutPackageVersion = (report: string): string => {
  const sarif: SarifLog = JSON.parse(report);
  const [first, ...rest] = sarif.runs;
  const masked: SarifLog = {
    ...sarif,
    runs: [{ ...first, tool: { ...first.tool, driver: { ...first.tool.driver, version: '<package version>' } } }, ...rest],
  };
  return `${JSON.stringify(masked, null, 2)}\n`;
};

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const checkJson = async (name: string) => {
  const { io, stdout } = captureIo(fixture(name));
  const code = await run(['check', '--format', 'json'], io);
  const findings = (JSON.parse(stdout()) as { findings: { severity: string; key: string }[] }).findings;
  return {
    code,
    findings: findings.map((finding) => `${finding.severity} ${finding.key}`).sort(),
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
        'error terminal-state-leak|test/fixtures/enum-inline/src/order.ts:Order|annotate|status|CANCELLED',
        'error transition-drift|test/fixtures/enum-inline/src/order.ts:Order|cancel|status|extra',
        'error transition-drift|test/fixtures/enum-inline/src/order.ts:Order|place|status|extra',
        'error undispatched-events|test/fixtures/enum-inline/src/aggregate-root.ts:AggregateRoot|events|',
        'error unreachable-state|test/fixtures/enum-inline/src/order.ts:Order||status|PAID',
        'warning transition-missing|test/fixtures/enum-inline/src/order.ts:Order|place|status|missing',
      ],
    });
  });

  it('boolean-rule: leaks past a rule-object guard on another field', async () => {
    expect(await checkJson('boolean-rule')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak|test/fixtures/boolean-rule/src/todo.ts:Todo|complete|deleted|true',
        'error terminal-state-leak|test/fixtures/boolean-rule/src/todo.ts:Todo|delete|deleted|true',
        'error undispatched-events|test/fixtures/boolean-rule/src/aggregate-root.ts:AggregateRoot|events|',
      ],
    });
  });

  it('nullable-timestamp: every method still runs after closing', async () => {
    expect(await checkJson('nullable-timestamp')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|close|closedAt|set',
        'error terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|deposit|closedAt|set',
        'error terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|lock|closedAt|set',
        'error terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|withdraw|closedAt|set',
      ],
    });
  });

  it('outside-spec: state changed from a service and a specification', async () => {
    expect(await checkJson('outside-spec')).toEqual({
      code: 1,
      findings: [
        'error outside-mutation|test/fixtures/outside-spec/src/invitation.ts:Invitation||status|InvitationService.accept',
        'error outside-mutation|test/fixtures/outside-spec/src/invitation.ts:Invitation||status|WithStatus.mutate',
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

  it('event-flows: one finding per event-flow rule', async () => {
    expect(await checkJson('event-flows')).toEqual({
      code: 1,
      findings: [
        'error dead-handler|test/fixtures/event-flows/src/events.ts:RefundIssued|RefundHandler.handle|',
        'error handler-payload-mismatch|test/fixtures/event-flows/src/events.ts:OrderPlaced|OrderPlacedHandler.handle|test/fixtures/event-flows/src/events.ts:PaymentCaptured',
        'error saga-missing-failure-path|test/fixtures/event-flows/src/events.ts:PaymentFailed|test/fixtures/event-flows/src/saga.ts:OrderSaga|test/fixtures/event-flows/src/events.ts:PaymentCaptured',
        'error undispatched-events|test/fixtures/event-flows/src/aggregates.ts:Undispatched|events|',
        'error unhandled-event|test/fixtures/event-flows/src/events.ts:Shipped||',
      ],
    });
  });

  it('event-flows: text report', async () => {
    expect(await output('event-flows', ['check'])).toMatchSnapshot();
  });

  it('event-flows: sarif report', async () => {
    expect(withoutPackageVersion(await output('event-flows', ['check', '--format', 'sarif']))).toMatchSnapshot();
  });

  it('event-flows: diagram', async () => {
    expect(await output('event-flows', ['show'])).toMatchSnapshot();
  });
});
