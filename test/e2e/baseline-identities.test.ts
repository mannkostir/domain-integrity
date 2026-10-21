import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_CONFIG, TICKET_PROJECT, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

type WireEntry = { readonly rule: string; readonly count: number } & Readonly<Record<string, unknown>>;

const baselineEntriesOf = async (dir: string): Promise<readonly WireEntry[]> => {
  const path = join(realpathSync(mkdtempSync(join(tmpdir(), 'domain-integrity-entries-'))), 'baseline.json');
  await run(['check', '--update-baseline', '--baseline', path], captureIo(dir).io);
  return (JSON.parse(readFileSync(path, 'utf8')) as { findings: WireEntry[] }).findings;
};

const ticketProject = (rewrite: (text: string) => string): string =>
  writeProject({
    ...TICKET_SOURCES,
    'src/ticket.ts': rewrite(TICKET_SOURCES['src/ticket.ts']),
    'domain.config.ts': rewrite(TICKET_CONFIG),
  });

const leakEntries = async (dir: string): Promise<readonly WireEntry[]> =>
  (await baselineEntriesOf(dir)).filter((entry) => entry.rule === 'terminal-state-leak');

const INVITATION_SOURCES = {
  'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
  'src/invitation.ts': `
import { AggregateRoot } from './aggregate-root';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected';
export class Invitation extends AggregateRoot<{ email: string }> {
  status: InvitationStatus = 'pending';
}
`,
  'domain.config.ts': `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Invitation } from './src/invitation';
export default defineDomain({ lifecycles: [lifecycle(Invitation, { states: { status: { terminal: ['accepted', 'rejected'] } } })] });
`,
};

const reopenWith = (writes: readonly string[]): Record<string, string> => ({
  ...INVITATION_SOURCES,
  'src/mapper.ts': `import { Invitation } from './invitation';\nexport function reopen(invitation: Invitation): void {\n${writes.map((write) => `  ${write}\n`).join('')}}\n`,
});

const BASELINE_FILE = 'domain-integrity.baseline.json';

const checkJson = async (dir: string): Promise<{ readonly code: number; readonly findings: readonly { readonly ruleId: string }[] }> => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', '--format', 'json'], io);
  return { code, findings: JSON.parse(stdout()).findings };
};

const at = (name: string, file: string, className: string): string => `test/fixtures/${name}/src/${file}:${className}`;

describe('baseline identities', () => {
  it('records the lifecycle rules of enum-inline', async () => {
    const order = at('enum-inline', 'order.ts', 'Order');

    expect(await baselineEntriesOf(fixture('enum-inline'))).toEqual([
      { rule: 'terminal-state-leak', aggregate: order, method: 'annotate', field: 'status', values: ['CANCELLED'], count: 1 },
      { rule: 'transition-drift', aggregate: order, method: 'cancel', field: 'status', kind: 'extra', count: 1 },
      { rule: 'transition-drift', aggregate: order, method: 'place', field: 'status', kind: 'extra', count: 1 },
      { rule: 'transition-missing', aggregate: order, method: 'place', field: 'status', count: 1 },
      { rule: 'undispatched-events', owner: at('enum-inline', 'aggregate-root.ts', 'AggregateRoot'), buffer: 'events', count: 1 },
      { rule: 'unreachable-state', aggregate: order, field: 'status', value: 'PAID', count: 1 },
    ]);
  });

  it('records boolean state values', async () => {
    const todo = at('boolean-rule', 'todo.ts', 'Todo');

    expect(await baselineEntriesOf(fixture('boolean-rule'))).toEqual([
      { rule: 'terminal-state-leak', aggregate: todo, method: 'complete', field: 'deleted', values: ['true'], count: 1 },
      { rule: 'terminal-state-leak', aggregate: todo, method: 'delete', field: 'deleted', values: ['true'], count: 1 },
      { rule: 'undispatched-events', owner: at('boolean-rule', 'aggregate-root.ts', 'AggregateRoot'), buffer: 'events', count: 1 },
    ]);
  });

  it('records nullable state values', async () => {
    const account = at('nullable-timestamp', 'account.ts', 'Account');

    expect(await baselineEntriesOf(fixture('nullable-timestamp'))).toEqual(
      ['close', 'deposit', 'lock', 'withdraw'].map((method) => ({ rule: 'terminal-state-leak', aggregate: account, method, field: 'closedAt', values: ['set'], count: 1 })),
    );
  });

  it('records the event-flow rules', async () => {
    const event = (name: string): string => at('event-flows', 'events.ts', name);

    expect(await baselineEntriesOf(fixture('event-flows'))).toEqual([
      { rule: 'dead-handler', event: event('RefundIssued'), handlerClass: at('event-flows', 'handlers.ts', 'RefundHandler'), handlerMethod: 'handle', count: 1 },
      {
        rule: 'handler-payload-mismatch',
        event: event('OrderPlaced'),
        handlerClass: at('event-flows', 'handlers.ts', 'OrderPlacedHandler'),
        handlerMethod: 'handle',
        declared: [event('PaymentCaptured')],
        count: 1,
      },
      { rule: 'saga-missing-failure-path', saga: at('event-flows', 'saga.ts', 'OrderSaga'), success: event('PaymentCaptured'), failure: event('PaymentFailed'), count: 1 },
      { rule: 'undispatched-events', owner: at('event-flows', 'aggregates.ts', 'Undispatched'), buffer: 'events', count: 1 },
      { rule: 'unhandled-event', event: event('Shipped'), count: 1 },
    ]);
  });

  it('records outside mutations by their enclosing scope', async () => {
    const invitation = at('outside-spec', 'invitation.ts', 'Invitation');
    const file = (name: string): string => `test/fixtures/outside-spec/src/${name}.ts`;

    expect(await baselineEntriesOf(fixture('outside-spec'))).toEqual([
      { rule: 'outside-mutation', aggregate: invitation, field: 'status', file: file('invitation-service'), scope: 'InvitationService.accept', count: 1 },
      { rule: 'outside-mutation', aggregate: invitation, field: 'status', file: file('with-status'), scope: 'WithStatus.mutate', count: 1 },
    ]);
  });

  it('records a qualified aggregate id by its path', async () => {
    const order = 'test/fixtures/nx-monorepo/libs/orders/src/order.ts:Order';

    expect(await baselineEntriesOf(fixture('nx-monorepo'))).toEqual([
      { rule: 'outside-mutation', aggregate: order, field: 'status', file: 'test/fixtures/nx-monorepo/apps/api/src/cancel-order.ts', scope: 'CancelOrder.execute', count: 1 },
      { rule: 'outside-mutation', aggregate: order, field: 'status', file: 'test/fixtures/nx-monorepo/libs/orders/src/order-mapper.ts', scope: 'OrderMapper.reopen', count: 1 },
    ]);
  });

  it('keeps the entry when an enum member is renamed and its value kept', async () => {
    const renamed = await leakEntries(ticketProject((text) => text.replaceAll('closed', 'done')));

    expect(renamed.map((entry) => entry.values)).toEqual([['CLOSED']]);
  });

  it('changes the entry when an enum value changes', async () => {
    const changed = await leakEntries(ticketProject((text) => text.replace("'CLOSED'", "'DONE'")));

    expect(changed.map((entry) => entry.values)).toEqual([['DONE']]);
  });

  it('counts a second outside write in a baselined function as new', async () => {
    const dir = writeProject(reopenWith(["invitation.status = 'pending';"]));
    await run(['check', '--update-baseline'], captureIo(dir).io);
    writeFileSync(join(dir, 'src/mapper.ts'), reopenWith(["invitation.status = 'pending';", "invitation.status = 'rejected';"])['src/mapper.ts']!);

    const result = await checkJson(dir);

    expect({ code: result.code, rules: result.findings.map((found) => found.ruleId) }).toEqual({
      code: 1,
      rules: ['outside-mutation', 'outside-mutation'],
    });
  });

  it('keeps a baselined outside write known while its count holds', async () => {
    const dir = writeProject(reopenWith(["invitation.status = 'pending';"]));
    await run(['check', '--update-baseline'], captureIo(dir).io);

    expect((await checkJson(dir)).code).toBe(0);
  });

  it('rejects a version 1 baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, BASELINE_FILE), '{"version":1,"findings":[]}');
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['check'], io), told: stderr().includes('uses format version 1') }).toEqual({ code: 2, told: true });
  });

  it('replaces a version 1 baseline on --update-baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, BASELINE_FILE), '{"version":1,"findings":[]}');

    const code = await run(['check', '--update-baseline'], captureIo(dir).io);

    expect({ code, version: JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8')).version }).toEqual({ code: 0, version: 2 });
  });
});
