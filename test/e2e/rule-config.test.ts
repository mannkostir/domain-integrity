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

const RENAME_SUPPRESSION = "suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'rename', reason: 'Titles may change.' })],";

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

  it('lists a suppression that matches nothing as stale', async () => {
    const { stdout } = await check(project("suppressions: [suppress(Ticket, { rule: 'terminal-state-leak', member: 'close', reason: 'R' })],"));

    expect(stdout).toContain('  domain.config.ts:5 terminal-state-leak Ticket.close');
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
