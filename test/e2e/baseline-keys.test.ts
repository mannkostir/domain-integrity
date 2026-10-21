import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_CONFIG, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const baselineKeysOf = async (dir: string): Promise<readonly string[]> => {
  const path = join(realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-keys-'))), 'baseline.json');
  await run(['check', '--update-baseline', '--baseline', path], captureIo(dir).io);
  return (JSON.parse(readFileSync(path, 'utf8')) as { findings: string[] }).findings;
};

const ticketProject = (rewrite: (text: string) => string): string =>
  writeProject({
    ...TICKET_SOURCES,
    'src/ticket.ts': rewrite(TICKET_SOURCES['src/ticket.ts']),
    'domain.config.ts': rewrite(TICKET_CONFIG),
  });

const leakKeys = async (dir: string): Promise<readonly string[]> =>
  (await baselineKeysOf(dir)).filter((key) => key.startsWith('terminal-state-leak|'));

describe('baseline keys', () => {
  it('keys the lifecycle rules of enum-inline', async () => {
    expect(await baselineKeysOf(fixture('enum-inline'))).toEqual([
      'terminal-state-leak|test/fixtures/enum-inline/src/order.ts:Order|annotate|status|CANCELLED',
      'transition-drift|test/fixtures/enum-inline/src/order.ts:Order|cancel|status|extra',
      'transition-drift|test/fixtures/enum-inline/src/order.ts:Order|place|status|extra',
      'transition-missing|test/fixtures/enum-inline/src/order.ts:Order|place|status|missing',
      'undispatched-events|test/fixtures/enum-inline/src/aggregate-root.ts:AggregateRoot|events|',
      'unreachable-state|test/fixtures/enum-inline/src/order.ts:Order||status|PAID',
    ]);
  });

  it('keys boolean state values', async () => {
    expect(await baselineKeysOf(fixture('boolean-rule'))).toEqual([
      'terminal-state-leak|test/fixtures/boolean-rule/src/todo.ts:Todo|complete|deleted|true',
      'terminal-state-leak|test/fixtures/boolean-rule/src/todo.ts:Todo|delete|deleted|true',
      'undispatched-events|test/fixtures/boolean-rule/src/aggregate-root.ts:AggregateRoot|events|',
    ]);
  });

  it('keys nullable state values', async () => {
    expect(await baselineKeysOf(fixture('nullable-timestamp'))).toEqual([
      'terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|close|closedAt|set',
      'terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|deposit|closedAt|set',
      'terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|lock|closedAt|set',
      'terminal-state-leak|test/fixtures/nullable-timestamp/src/account.ts:Account|withdraw|closedAt|set',
    ]);
  });

  it('keys the event-flow rules', async () => {
    expect(await baselineKeysOf(fixture('event-flows'))).toEqual([
      'dead-handler|test/fixtures/event-flows/src/events.ts:RefundIssued|RefundHandler.handle|',
      'handler-payload-mismatch|test/fixtures/event-flows/src/events.ts:OrderPlaced|OrderPlacedHandler.handle|test/fixtures/event-flows/src/events.ts:PaymentCaptured',
      'saga-missing-failure-path|test/fixtures/event-flows/src/events.ts:PaymentFailed|test/fixtures/event-flows/src/saga.ts:OrderSaga|test/fixtures/event-flows/src/events.ts:PaymentCaptured',
      'undispatched-events|test/fixtures/event-flows/src/aggregates.ts:Undispatched|events|',
      'unhandled-event|test/fixtures/event-flows/src/events.ts:Shipped||',
    ]);
  });

  it('keys outside mutations by their enclosing scope', async () => {
    expect(await baselineKeysOf(fixture('outside-spec'))).toEqual([
      'outside-mutation|test/fixtures/outside-spec/src/invitation.ts:Invitation||status|InvitationService.accept',
      'outside-mutation|test/fixtures/outside-spec/src/invitation.ts:Invitation||status|WithStatus.mutate',
    ]);
  });

  it('keys a qualified aggregate id by its path', async () => {
    expect(await baselineKeysOf(fixture('nx-monorepo'))).toEqual([
      'outside-mutation|test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order||status|CancelOrder.execute',
      'outside-mutation|test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order||status|OrderMapper.reopen',
    ]);
  });

  it('keeps the key when an enum member is renamed and its value kept', async () => {
    const renamed = await leakKeys(ticketProject((text) => text.replaceAll('closed', 'done')));

    expect(renamed).toEqual(['terminal-state-leak|src/ticket.ts:Ticket|rename|status|CLOSED']);
  });

  it('changes the key when an enum value changes', async () => {
    const changed = await leakKeys(ticketProject((text) => text.replace("'CLOSED'", "'DONE'")));

    expect(changed).toEqual(['terminal-state-leak|src/ticket.ts:Ticket|rename|status|DONE']);
  });
});
