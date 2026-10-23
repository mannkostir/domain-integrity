import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

const config = (options: string, transition: string): string => `import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({
  ${options},
  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed], transitions: { close: ${transition} } } } })],
});
`;

const OLD_CONFIG = config("eventMethods: ['addEvent']", '[TicketStatus.open]');
const NEW_CONFIG = config("events: { raiseMethods: ['addEvent'] }", '{ from: [TicketStatus.open] }');

const EVENT_METHODS_WARNING = 'warning: domain.config.ts:4 "eventMethods" is deprecated; use "events.raiseMethods". Old names stop working in 1.0.\n';

const runIn = async (files: Readonly<Record<string, string>>, args: readonly string[]) => {
  const { io, stdout, stderr } = captureIo(writeProject(files));
  const code = await run([...args], io);
  return { code, stdout: stdout(), stderr: stderr() };
};

describe('a config that uses old option names', () => {
  it('warns on check', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['check']);

    expect(stderr).toContain(EVENT_METHODS_WARNING);
  });

  it('warns about a bare transitions array', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['check']);

    expect(stderr).toContain('warning: domain.config.ts:5 "transitions.close: [...]" is deprecated; use "transitions.close: { from: [...] }". Old names stop working in 1.0.\n');
  });

  it('reports the same findings and exit code as the grouped config', async () => {
    const old = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['check', '--format', 'json']);
    const grouped = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': NEW_CONFIG }, ['check', '--format', 'json']);

    expect({ code: old.code, stdout: old.stdout }).toEqual({ code: grouped.code, stdout: grouped.stdout });
  });

  it('does not warn for the grouped config', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': NEW_CONFIG }, ['check']);

    expect(stderr).not.toContain('deprecated');
  });

  it('warns on show', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['show']);

    expect(stderr).toContain(EVENT_METHODS_WARNING);
  });

  it('warns on context', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['context']);

    expect(stderr).toContain(EVENT_METHODS_WARNING);
  });

  it('warns once on init', async () => {
    const { stderr } = await runIn({ ...TICKET_SOURCES, 'domain.config.ts': OLD_CONFIG }, ['init', '--yes']);

    expect(stderr.split(EVENT_METHODS_WARNING).length - 1).toBe(1);
  });

  it('still warns when no aggregates are found', async () => {
    const emptyConfig = "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({\n  lifecycles: [],\n  eventMethods: ['addEvent'],\n});\n";
    const { code, stderr } = await runIn({ 'src/empty.ts': 'export const nothing = 1;\n', 'domain.config.ts': emptyConfig }, ['check']);

    expect({ code, warned: stderr.includes(EVENT_METHODS_WARNING) }).toEqual({ code: 2, warned: true });
  });
});
