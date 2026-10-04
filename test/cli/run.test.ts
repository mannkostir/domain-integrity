import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { TICKET_PROJECT, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

describe('check', () => {
  it('exits 1 and prints the leak for an unguarded mutating method', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));

    expect({ code: await run(['check'], io), leak: stdout().includes('terminal-state-leak  Ticket.rename()') }).toEqual({ code: 1, leak: true });
  });

  it('writes machine-readable JSON', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['check', '--format', 'json'], io);

    expect(JSON.parse(stdout()).findings.map((finding: { method: string }) => finding.method)).toEqual(['rename']);
  });

  it('exits 0 for findings already in the baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);
    const { io, stdout } = captureIo(dir);

    expect({ code: await run(['check', '--baseline', 'baseline.json'], io), known: stdout().includes('(baseline)') }).toEqual({ code: 0, known: true });
  });

  it('exits 2 and suggests init when the config is missing', async () => {
    const { io, stderr } = captureIo(writeProject(TICKET_SOURCES));

    expect({ code: await run(['check'], io), hint: stderr().includes('domain-integrity init') }).toEqual({ code: 2, hint: true });
  });

  it('exits 2 when a declared field does not exist', async () => {
    const config = TICKET_PROJECT['domain.config.ts'].replace('status: {', 'missing: {');
    const { io, stderr } = captureIo(writeProject({ ...TICKET_PROJECT, 'domain.config.ts': config }));

    expect({ code: await run(['check'], io), problem: stderr().includes('Ticket has no field "missing"') }).toEqual({ code: 2, problem: true });
  });

  it('exits 2 for an unknown output format', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['check', '--format', 'xml'], io)).toBe(2);
  });

  it('exits 2 when the project has no aggregates', async () => {
    const { io, stderr } = captureIo(
      writeProject({ 'src/a.ts': 'export const a = 1;\n', 'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n" }),
    );

    expect({
      code: await run(['check'], io),
      searched: stderr().includes('Searched for classes extending or implementing: AggregateRoot, Entity'),
      example: stderr().includes("export default defineDomain({ aggregateBaseClasses: ['MyAggregateBase'] })"),
    }).toEqual({ code: 2, searched: true, example: true });
  });
});

const WARNING_ONLY_PROJECT = {
  ...TICKET_SOURCES,
  'src/ticket.ts': TICKET_SOURCES['src/ticket.ts'].replace(
    'rename(title: string): void {',
    'rename(title: string): void { if (this.props.status === TicketStatus.closed) return;',
  ),
  'domain.config.ts': TICKET_PROJECT['domain.config.ts'].replace(
    '{ terminal: [TicketStatus.closed] }',
    '{ terminal: [TicketStatus.closed], transitions: { close: [TicketStatus.open, TicketStatus.closed] } }',
  ),
};

const MISSING_FIELD_PROJECT = {
  ...TICKET_PROJECT,
  'domain.config.ts': TICKET_PROJECT['domain.config.ts'].replace('status: {', 'missing: {'),
};

describe('check exit codes', () => {
  it('exits 0 when the only finding is a warning', async () => {
    const { io, stdout } = captureIo(writeProject(WARNING_ONLY_PROJECT));

    expect({ code: await run(['check'], io), warned: stdout().includes('transition-drift') }).toEqual({ code: 0, warned: true });
  });

  it('exits 2 when problems and error findings both exist', async () => {
    const config = `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';
export default defineDomain({ lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] }, missing: { terminal: [1] } } })] });
`;
    const { io } = captureIo(writeProject({ ...TICKET_PROJECT, 'domain.config.ts': config }));

    expect(await run(['check'], io)).toBe(2);
  });

  it('exits 2 when the baseline cannot be written', async () => {
    const { io, stderr } = captureIo(writeProject(TICKET_PROJECT));

    expect({ code: await run(['check', '--update-baseline', '--baseline', 'missing-dir/b.json'], io), cannot: stderr().includes('Cannot write') }).toEqual({
      code: 2,
      cannot: true,
    });
  });

  it('does not write the baseline when there are problems', async () => {
    const dir = writeProject(MISSING_FIELD_PROJECT);
    const { io, stderr } = captureIo(dir);
    const code = await run(['check', '--update-baseline', '--baseline', 'baseline.json'], io);

    expect({ code, written: existsSync(join(dir, 'baseline.json')), notice: stderr().includes('Baseline not written because of the problems above.') }).toEqual({
      code: 2,
      written: false,
      notice: true,
    });
  });
});

describe('program', () => {
  it('exits 0 for --help', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['--help'], io)).toBe(0);
  });

  it('exits 2 for an unknown command', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['frobnicate'], io)).toBe(2);
  });
});

describe('show', () => {
  it('prints a mermaid diagram for each declared aggregate', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['show'], io);

    expect(stdout().startsWith('## Ticket.status\n\n```mermaid\nstateDiagram-v2')).toBe(true);
  });

  it('exits 2 for an aggregate that is not declared', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['show', 'Payment'], io)).toBe(2);
  });
});

describe('context', () => {
  it('prints the lifecycle summary', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['context'], io);

    expect(stdout()).toContain('### Ticket (src/ticket.ts)');
  });

  it('writes into an existing file without touching the rest of it', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nKeep this.\n');
    await run(['context', '--write', 'AGENTS.md'], captureIo(dir).io);
    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

    expect({ kept: written.startsWith('# Agents\n\nKeep this.\n'), added: written.includes('### Ticket') }).toEqual({ kept: true, added: true });
  });

  it('creates the target file when it does not exist', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['context', '--write', 'CLAUDE.md'], captureIo(dir).io);

    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
  });

  it('exits 2 when the target is a directory', async () => {
    const dir = writeProject(TICKET_PROJECT);
    mkdirSync(join(dir, 'docs'));
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['context', '--write', 'docs'], io), cannot: stderr().includes('Cannot') }).toEqual({ code: 2, cannot: true });
  });

  it('leaves exactly one marker block when run twice', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n\nKeep this.\n');
    await run(['context', '--write', 'AGENTS.md'], captureIo(dir).io);
    await run(['context', '--write', 'AGENTS.md'], captureIo(dir).io);
    const written = readFileSync(join(dir, 'AGENTS.md'), 'utf8');

    expect({ starts: written.split('<!-- domain-integrity:start -->').length - 1, kept: written.startsWith('# Agents\n\nKeep this.\n') }).toEqual({
      starts: 1,
      kept: true,
    });
  });
});
