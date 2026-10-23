import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const ticketConfig = (options: string, transitions = ''): string => `import { defineDomain, lifecycle, suppress } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({
  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed]${transitions} } } })],
  ${options}
});
`;

const check = async (dir: string, args: readonly string[] = []) => {
  const { io, stdout } = captureIo(dir);
  const code = await run(['check', ...args], io);
  return { code, stdout: stdout() };
};

const project = (options: string, transitions = ''): string => writeProject({ ...TICKET_SOURCES, 'domain.config.ts': ticketConfig(options, transitions) });

const PRIVATE_HANDLER_SOURCES = {
  'src/aggregate-root.ts': 'export abstract class AggregateRoot {\n  protected register<E>(handler: (event: E) => void, event: new () => E): void {}\n}\n',
  'src/events.ts': 'export class Unused {}\n',
  'src/order.ts': "import { AggregateRoot } from './aggregate-root';\nimport { Unused } from './events';\nexport class Order extends AggregateRoot {\n  constructor() { super(); this.register(this.onUnused, Unused); }\n  private onUnused(e: Unused) {}\n}\n",
};

const orderConfig = (options: string): string => `import { defineDomain, suppress } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({ ${options} });
`;

const RENAME_SUPPRESSION = "suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'rename', reason: 'Titles may change.' })],";

const RENAME_AND_STALE_SUPPRESSIONS =
  "suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'rename', reason: 'Titles may change.' }), suppress(Ticket, { rule: 'terminal-state-leak', member: 'close', reason: 'R' })],";

const MISSING_FIELD_CONFIG = `import { defineDomain, lifecycle, suppress } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({
  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] }, phase: { terminal: ['DONE'] } } })],
  suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'close', reason: 'R' })],
});
`;

describe('rule config in check', () => {
  it('exits 0 when the only failing rule is off', async () => {
    expect((await check(project("rules: { 'terminal-state-leak': 'off' },"))).code).toBe(0);
  });

  it('exits 0 when the only failing rule is lowered to a warning', async () => {
    expect((await check(project("rules: { 'terminal-state-leak': 'warning' },"))).code).toBe(0);
  });

  it('exits 1 when a warning rule is raised to an error', async () => {
    const dir = project("rules: { 'terminal-state-leak': 'off', 'transition-missing': 'error' },", ', transitions: { close: { from: [TicketStatus.open, TicketStatus.closed] } }');

    expect((await check(dir)).code).toBe(1);
  });

  it('exits 0 when the failing finding is suppressed', async () => {
    const { code, stdout } = await check(project(RENAME_SUPPRESSION));

    expect({ code, counted: stdout.includes('1 suppressed in config') }).toEqual({ code: 0, counted: true });
  });

  it('exits 0 when a dead handler on a private method is suppressed', async () => {
    const dir = writeProject({ ...PRIVATE_HANDLER_SOURCES, 'domain.config.ts': orderConfig("suppressions: [suppress(Order, { rule: 'dead-handler', member: 'onUnused', reason: 'Wired later.' })]") });
    const { code, stdout } = await check(dir);

    expect({ code, counted: stdout.includes('1 suppressed in config') }).toEqual({ code: 0, counted: true });
  });

  it('lists a suppression that matches nothing as stale', async () => {
    const { stdout } = await check(project("suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'close', reason: 'R' })],"));

    expect(stdout).toContain('  domain.config.ts:5 terminal-state-leak Ticket.close');
  });

  it('exits 0 when the only suppression left over is stale', async () => {
    const { code, stdout } = await check(project(RENAME_AND_STALE_SUPPRESSIONS));

    expect({ code, stale: stdout.includes('1 stale suppression, matching no finding:') }).toEqual({ code: 0, stale: true });
  });

  it('withholds stale suppressions when the run has a problem', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': MISSING_FIELD_CONFIG });
    const { code, stdout } = await check(dir);

    expect({ code, stale: stdout.includes('stale suppression') }).toEqual({ code: 2, stale: false });
  });

  it('leaves suppressed findings out of the baseline', async () => {
    const dir = project(RENAME_SUPPRESSION);
    await check(dir, ['--update-baseline']);

    expect(JSON.parse(readFileSync(join(dir, 'domain-integrity.baseline.json'), 'utf8')).findings).toEqual([]);
  });

  it('reports a baseline entry for a suppressed finding as stale', async () => {
    const dir = project('');
    await check(dir, ['--update-baseline']);
    writeFileSync(join(dir, 'domain.config.ts'), ticketConfig(RENAME_SUPPRESSION));
    const { stdout } = await check(dir);

    expect({ baseline: existsSync(join(dir, 'domain-integrity.baseline.json')), stale: stdout.includes('stale baseline entr'), suppressed: stdout.includes('1 suppressed in config') }).toEqual({
      baseline: true,
      stale: true,
      suppressed: true,
    });
  });
});
