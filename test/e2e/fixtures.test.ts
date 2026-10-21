import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { Identity, describeIdentity } from '../../src/report/identity';
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
  const findings = (JSON.parse(stdout()) as { findings: { severity: string; identity: Identity }[] }).findings;
  return {
    code,
    findings: findings.map((finding) => `${finding.severity} ${describeIdentity(finding.identity)}`).sort(),
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
        'error terminal-state-leak aggregate=test/fixtures/enum-inline/src/order.ts:Order method=annotate field=status values=CANCELLED',
        'error transition-drift aggregate=test/fixtures/enum-inline/src/order.ts:Order method=cancel field=status kind=extra',
        'error transition-drift aggregate=test/fixtures/enum-inline/src/order.ts:Order method=place field=status kind=extra',
        'error undispatched-events owner=test/fixtures/enum-inline/src/aggregate-root.ts:AggregateRoot buffer=events',
        'error unreachable-state aggregate=test/fixtures/enum-inline/src/order.ts:Order field=status value=PAID',
        'warning transition-missing aggregate=test/fixtures/enum-inline/src/order.ts:Order method=place field=status',
      ],
    });
  });

  it('boolean-rule: leaks past a rule-object guard on another field', async () => {
    expect(await checkJson('boolean-rule')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak aggregate=test/fixtures/boolean-rule/src/todo.ts:Todo method=complete field=deleted values=true',
        'error terminal-state-leak aggregate=test/fixtures/boolean-rule/src/todo.ts:Todo method=delete field=deleted values=true',
        'error undispatched-events owner=test/fixtures/boolean-rule/src/aggregate-root.ts:AggregateRoot buffer=events',
      ],
    });
  });

  it('nullable-timestamp: every method still runs after closing', async () => {
    expect(await checkJson('nullable-timestamp')).toEqual({
      code: 1,
      findings: [
        'error terminal-state-leak aggregate=test/fixtures/nullable-timestamp/src/account.ts:Account method=close field=closedAt values=set',
        'error terminal-state-leak aggregate=test/fixtures/nullable-timestamp/src/account.ts:Account method=deposit field=closedAt values=set',
        'error terminal-state-leak aggregate=test/fixtures/nullable-timestamp/src/account.ts:Account method=lock field=closedAt values=set',
        'error terminal-state-leak aggregate=test/fixtures/nullable-timestamp/src/account.ts:Account method=withdraw field=closedAt values=set',
      ],
    });
  });

  it('outside-spec: state changed from a service and a specification', async () => {
    expect(await checkJson('outside-spec')).toEqual({
      code: 1,
      findings: [
        'error outside-mutation aggregate=test/fixtures/outside-spec/src/invitation.ts:Invitation field=status file=test/fixtures/outside-spec/src/invitation-service.ts scope=InvitationService.accept',
        'error outside-mutation aggregate=test/fixtures/outside-spec/src/invitation.ts:Invitation field=status file=test/fixtures/outside-spec/src/with-status.ts scope=WithStatus.mutate',
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
        'error dead-handler event=test/fixtures/event-flows/src/events.ts:RefundIssued handlerClass=test/fixtures/event-flows/src/handlers.ts:RefundHandler handlerMethod=handle',
        'error handler-payload-mismatch event=test/fixtures/event-flows/src/events.ts:OrderPlaced handlerClass=test/fixtures/event-flows/src/handlers.ts:OrderPlacedHandler handlerMethod=handle declared=test/fixtures/event-flows/src/events.ts:PaymentCaptured',
        'error saga-missing-failure-path saga=test/fixtures/event-flows/src/saga.ts:OrderSaga success=test/fixtures/event-flows/src/events.ts:PaymentCaptured failure=test/fixtures/event-flows/src/events.ts:PaymentFailed',
        'error undispatched-events owner=test/fixtures/event-flows/src/aggregates.ts:Undispatched buffer=events',
        'error unhandled-event event=test/fixtures/event-flows/src/events.ts:Shipped',
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
