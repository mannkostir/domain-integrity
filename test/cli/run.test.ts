import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnalyzerRun } from '../../src/analysis';
import { analyse } from '../../src/analyzer';
import { lifecycleAnalyzer } from '../../src/analyzers/lifecycle/analyzer';
import { run } from '../../src/cli/run';
import { TICKET_PROJECT, TICKET_SOURCES, captureIo, writeNestedProject, writeProject, writeTree } from '../helpers/disk';
import { parseSarif } from '../helpers/sarif-log';

describe('check', () => {
  it('exits 1 and prints the leak for an unguarded mutating method', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));

    expect({ code: await run(['check'], io), leak: stdout().includes('terminal-state-leak  Ticket.rename()') }).toEqual({ code: 1, leak: true });
  });

  it('writes machine-readable JSON', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['check', '--format', 'json'], io);

    expect(JSON.parse(stdout()).findings.map((finding: { details: { method: string } }) => finding.details.method)).toEqual(['rename']);
  });

  it('exits 0 for findings already in the baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);
    const { io, stdout } = captureIo(dir);

    expect({ code: await run(['check', '--baseline', 'baseline.json'], io), stdout: stdout() }).toEqual({
      code: 0,
      stdout: '0 errors, 0 warnings, 1 known from baseline baseline.json\n',
    });
  });

  it('exits 0 with SARIF when every error finding is in the baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);

    expect(await run(['check', '--baseline', 'baseline.json', '--format', 'sarif'], captureIo(dir).io)).toBe(0);
  });

  it('reports baselined findings in SARIF as externally suppressed results', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json', '--format', 'sarif'], io);

    const results = parseSarif(stdout()).runs.flatMap((sarifRun) => sarifRun.results);

    expect(results.map((result) => ({ ruleId: result.ruleId, suppressions: result.suppressions?.map((suppression) => suppression.kind) }))).toEqual([
      { ruleId: 'terminal-state-leak', suppressions: ['external'] },
    ]);
  });

  it('exits 2 and explains a tsconfig that includes no source files', async () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ files: [] }) });
    const { io, stderr } = captureIo(dir);

    expect({
      code: await run(['check'], io),
      explained: stderr().includes('includes no source files'),
      misleading: stderr().includes('aggregateBaseClasses'),
    }).toEqual({ code: 2, explained: true, misleading: false });
  });

  it('exits 2 and explains a tsconfig that includes only the config', async () => {
    const dir = writeTree({ 'tsconfig.json': JSON.stringify({ include: ['domain.config.ts'] }), 'domain.config.ts': TICKET_PROJECT['domain.config.ts'] });
    const { io, stderr } = captureIo(dir);

    expect({
      code: await run(['check'], io),
      explained: stderr().includes('tsconfig.json includes no source files other than domain.config.ts.'),
    }).toEqual({ code: 2, explained: true });
  });

  it('does not reject a config that a composite tsconfig include leaves out', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT, { composite: true }));

    expect(await run(['check'], io)).toBe(1);
  });

  it('reports a type error of a config that a composite tsconfig include leaves out', async () => {
    const config = TICKET_PROJECT['domain.config.ts'].replace('TicketStatus.closed]', 'TicketStatus.missing]');
    const { io, stderr } = captureIo(writeProject({ ...TICKET_PROJECT, 'domain.config.ts': config }, { composite: true }));

    expect({ code: await run(['check'], io), reported: stderr().includes('Type errors in domain.config.ts') }).toEqual({ code: 2, reported: true });
  });

  it('analyses a solution whose reference includes JavaScript the solution options do not allow', async () => {
    const dir = writeProject({
      ...TICKET_PROJECT,
      'src/legacy.js': "export class Legacy { status = 'open'; }\n",
      'sol/tsconfig.json': JSON.stringify({
        extends: '../tsconfig.json',
        compilerOptions: { allowJs: false },
        files: [],
        references: [{ path: '..' }],
      }),
    }, { allowJs: true });
    const { io } = captureIo(dir);

    expect(await run(['check', '-p', 'sol/tsconfig.json', '-c', 'domain.config.ts'], io)).toBe(1);
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
      example: stderr().includes("export default defineDomain({ aggregates: { baseClasses: ['MyAggregateBase'] } })"),
    }).toEqual({ code: 2, searched: true, example: true });
  });

  it('writes the lifecycle baseline entry with its count', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);

    expect(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).findings).toEqual([TICKET_ENTRY]);
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

const MISSING_TSCONFIG_TAIL = 'Run domain-integrity from the project root, or pass -p with the path to your tsconfig.json or the directory that contains it.';

describe('project and config paths', () => {
  it('names the missing tsconfig.json in the cwd and how to point at the right one', async () => {
    const { io, stderr } = captureIo(writeTree({ 'src/a.ts': 'export const a = 1;\n' }));
    await run(['check'], io);

    expect(stderr()).toBe(`tsconfig not found: tsconfig.json. ${MISSING_TSCONFIG_TAIL}\n`);
  });

  it('exits 2 when the tsconfig is missing', async () => {
    const { io } = captureIo(writeTree({ 'src/a.ts': 'export const a = 1;\n' }));

    expect(await run(['check'], io)).toBe(2);
  });

  it('checks the project of the tsconfig.json inside a directory passed with -p', async () => {
    const { top } = writeNestedProject(TICKET_PROJECT);
    const { io, stdout } = captureIo(top);
    await run(['check', '-p', 'pkg', '-c', 'pkg/domain.config.ts'], io);

    expect(stdout()).toContain('terminal-state-leak  Ticket.rename()');
  });

  it('names the missing tsconfig.json inside a directory passed with -p', async () => {
    const { io, stderr } = captureIo(writeTree({ 'src/a.ts': 'export const a = 1;\n' }));
    await run(['check', '-p', 'src'], io);

    expect(stderr()).toBe(`tsconfig not found: src/tsconfig.json. ${MISSING_TSCONFIG_TAIL}\n`);
  });

  it('names the config passed with -c when it is missing and how to create or point at one', async () => {
    const { io, stderr } = captureIo(writeProject(TICKET_SOURCES));
    await run(['check', '-c', 'config/domain.config.ts'], io);

    expect(stderr()).toBe('config/domain.config.ts not found. Run "domain-integrity init" to create it, or pass -c with the path to your config file.\n');
  });
});

describe('check exit codes', () => {
  it('exits 0 when the only finding is a warning', async () => {
    const { io, stdout } = captureIo(writeProject(WARNING_ONLY_PROJECT));

    expect({ code: await run(['check'], io), warned: stdout().includes('transition-missing') }).toEqual({ code: 0, warned: true });
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

const TICKET_ENTRY = { rule: 'terminal-state-leak', aggregate: 'src/ticket.ts:Ticket', method: 'rename', field: 'status', values: ['CLOSED'], count: 1 };

const GHOST_ENTRY = { rule: 'terminal-state-leak', aggregate: 'src/ghost.ts:Ghost', method: 'vanish', field: 'status', values: ['CLOSED'], count: 1 };

const DEFAULT_BASELINE = 'domain-integrity.baseline.json';

const writeBaseline = (dir: string, path: string, entries: readonly object[]): void =>
  writeFileSync(join(dir, path), JSON.stringify({ version: 2, findings: entries }));

const duplicatingLifecycle: AnalyzerRun = (input) => {
  const result = analyse(lifecycleAnalyzer, input);
  return { ...result, findings: [...result.findings, ...result.findings] };
};

describe('check with a baseline', () => {
  it('prints only the summary line when the baseline covers every finding', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY]);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json'], io);

    expect(stdout()).toBe('0 errors, 0 warnings, 1 known from baseline baseline.json\n');
  });

  it('lists known findings marked as baseline with --show-known', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY]);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json', '--show-known'], io);

    expect(stdout()).toContain('terminal-state-leak  Ticket.rename()  src/ticket.ts:6 (baseline)');
  });

  it('loads the default baseline file from the working directory', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, DEFAULT_BASELINE, [TICKET_ENTRY]);
    const { io, stdout } = captureIo(dir);

    expect({ code: await run(['check'], io), stdout: stdout() }).toEqual({
      code: 0,
      stdout: '0 errors, 0 warnings, 1 known from baseline domain-integrity.baseline.json\n',
    });
  });

  it('runs without a baseline when the default file is absent', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));

    expect({ code: await run(['check'], io), summary: stdout().endsWith('1 error, 0 warnings\n') }).toEqual({ code: 1, summary: true });
  });

  it('prefers an explicit baseline over the default file', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, DEFAULT_BASELINE, [TICKET_ENTRY]);
    writeBaseline(dir, 'empty.json', []);

    expect(await run(['check', '--baseline', 'empty.json'], captureIo(dir).io)).toBe(1);
  });

  it('exits 2 when the default baseline file is not valid JSON', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, DEFAULT_BASELINE), 'not json');
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['check'], io), invalid: stderr().includes('domain-integrity.baseline.json is not valid JSON.') }).toEqual({
      code: 2,
      invalid: true,
    });
  });

  it('exits 2 when the default baseline file is not a baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeFileSync(join(dir, DEFAULT_BASELINE), '{"version": 2}');
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['check'], io), rejected: stderr().includes('domain-integrity.baseline.json is not a domain-integrity baseline.') }).toEqual({
      code: 2,
      rejected: true,
    });
  });

  it('exits 2 when an explicit baseline is missing even if the default file exists', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, DEFAULT_BASELINE, [TICKET_ENTRY]);
    const { io, stderr } = captureIo(dir);

    expect({ code: await run(['check', '--baseline', 'missing.json'], io), notFound: stderr().includes('not found') }).toEqual({
      code: 2,
      notFound: true,
    });
  });

  it('lists stale baseline entries in the text output', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY, GHOST_ENTRY]);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json'], io);

    expect(stdout()).toBe(
      [
        '1 stale baseline entry, remove with --update-baseline:',
        '  terminal-state-leak aggregate=src/ghost.ts:Ghost method=vanish field=status values=CLOSED',
        '',
        '0 errors, 0 warnings, 1 known from baseline baseline.json',
        '',
      ].join('\n'),
    );
  });

  it('exits 0 when the baseline has stale entries', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY, GHOST_ENTRY]);

    expect(await run(['check', '--baseline', 'baseline.json'], captureIo(dir).io)).toBe(0);
  });

  it('keeps the JSON output free of baseline details', async () => {
    const dir = writeProject(TICKET_PROJECT);
    const plain = captureIo(dir);
    await run(['check', '--format', 'json'], plain.io);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY, GHOST_ENTRY]);
    const withBaseline = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json', '--format', 'json'], withBaseline.io);

    expect(Object.keys(JSON.parse(withBaseline.stdout()))).toEqual(Object.keys(JSON.parse(plain.stdout())));
  });

  it('does not report stale entries when the run has problems', async () => {
    const dir = writeProject(MISSING_FIELD_PROJECT);
    writeBaseline(dir, 'baseline.json', [GHOST_ENTRY]);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--baseline', 'baseline.json'], io);

    expect(stdout().includes('stale')).toBe(false);
  });

  it('prunes stale entries when updating the baseline', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, 'baseline.json', [TICKET_ENTRY, GHOST_ENTRY]);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);

    expect(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).findings).toEqual([TICKET_ENTRY]);
  });

  it('reports the number of entries written in the plural', async () => {
    const { io, stdout } = captureIo(writeProject(SAME_NAMED_PROJECT));
    await run(['check', '--update-baseline'], io);

    expect(stdout()).toBe('Baseline written to domain-integrity.baseline.json with 2 entries.\n');
  });

  it('reports the number of distinct entries written', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['check', '--update-baseline'], io, [duplicatingLifecycle]);

    expect(stdout()).toBe('Baseline written to domain-integrity.baseline.json with 1 entry.\n');
  });

  it('reports an auto-loaded baseline as suppressed results in SARIF', async () => {
    const dir = writeProject(TICKET_PROJECT);
    writeBaseline(dir, DEFAULT_BASELINE, [TICKET_ENTRY]);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--format', 'sarif'], io);

    const results = parseSarif(stdout()).runs.flatMap((sarifRun) => sarifRun.results);

    expect(results.map((result) => result.suppressions?.map((suppression) => suppression.kind))).toEqual([['external']]);
  });
});

describe('program', () => {
  it('exits 0 for --help', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['--help'], io)).toBe(0);
  });

  it('names the show argument after what it accepts', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['show', '--help'], io);

    expect(stdout()).toContain('show [options] [name]');
  });

  it('describes --show-known as listing baselined and suppressed findings', async () => {
    const { io, stdout } = captureIo(writeProject(TICKET_PROJECT));
    await run(['check', '--help'], io);

    expect(stdout().replace(/\s+/g, ' ')).toContain('--show-known list findings accepted by the baseline or suppressed in the config in the text output');
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

  it('prints the diagram of an aggregate named by its path', async () => {
    const { io } = captureIo(writeProject(TICKET_PROJECT));

    expect(await run(['show', 'src/ticket.ts:Ticket'], io)).toBe(0);
  });
});

const sameNamedTicket = (closed: string): string => `
import { AggregateRoot } from '../aggregate-root';
export enum TicketStatus { open = 'OPEN', closed = '${closed}' }
export class Ticket extends AggregateRoot<{ status: TicketStatus; title: string }> {
  static open(title: string): Ticket { return new Ticket({ status: TicketStatus.open, title }); }
  rename(title: string): void { this.props.title = title; }
  close(): void { if (this.props.status === TicketStatus.closed) return; this.props.status = TicketStatus.closed; }
}
`;

const SAME_NAMED_PROJECT = {
  'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
  'src/a/ticket.ts': sameNamedTicket('CLOSED_A'),
  'src/b/ticket.ts': sameNamedTicket('CLOSED_B'),
  'domain.config.ts': `
import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket as TicketA, TicketStatus as TicketStatusA } from './src/a/ticket';
import { Ticket as TicketB, TicketStatus as TicketStatusB } from './src/b/ticket';
export default defineDomain({
  lifecycles: [
    lifecycle(TicketA, { states: { status: { terminal: [TicketStatusA.closed] } } }),
    lifecycle(TicketB, { states: { status: { terminal: [TicketStatusB.closed] } } }),
  ],
});
`,
};

describe('same-named aggregates', () => {
  it('exits 2 and lists the qualified names for an ambiguous show', async () => {
    const { io, stderr } = captureIo(writeProject(SAME_NAMED_PROJECT));

    expect({
      code: await run(['show', 'Ticket'], io),
      a: stderr().includes('src/a/ticket.ts:Ticket'),
      b: stderr().includes('src/b/ticket.ts:Ticket'),
    }).toEqual({ code: 2, a: true, b: true });
  });

  it('shows only the aggregate named by its path', async () => {
    const { io, stdout } = captureIo(writeProject(SAME_NAMED_PROJECT));

    expect({ code: await run(['show', 'src/a/ticket.ts:Ticket'], io), output: stdout().match(/^## .*$/gm) }).toEqual({
      code: 0,
      output: ['## src/a/ticket.ts:Ticket.status'],
    });
  });

  it('shows the aggregate named by a dot-prefixed path', async () => {
    const { io, stdout } = captureIo(writeProject(SAME_NAMED_PROJECT));

    expect({ code: await run(['show', './src/b/ticket.ts:Ticket'], io), output: stdout().match(/^## .*$/gm) }).toEqual({
      code: 0,
      output: ['## src/b/ticket.ts:Ticket.status'],
    });
  });

  it('writes path-qualified baseline entries', async () => {
    const dir = writeProject(SAME_NAMED_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);

    expect(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).findings).toEqual([
      { rule: 'terminal-state-leak', aggregate: 'src/a/ticket.ts:Ticket', method: 'rename', field: 'status', values: ['CLOSED_A'], count: 1 },
      { rule: 'terminal-state-leak', aggregate: 'src/b/ticket.ts:Ticket', method: 'rename', field: 'status', values: ['CLOSED_B'], count: 1 },
    ]);
  });

  it('reports the plain name in the details and the qualified id in the identity in JSON', async () => {
    const { io, stdout } = captureIo(writeProject(SAME_NAMED_PROJECT));
    await run(['check', '--format', 'json'], io);

    expect(
      JSON.parse(stdout()).findings.map((finding: { details: { aggregate: string }; identity: { aggregate: string } }) => [finding.details.aggregate, finding.identity.aggregate]),
    ).toEqual([
      ['Ticket', 'src/a/ticket.ts:Ticket'],
      ['Ticket', 'src/b/ticket.ts:Ticket'],
    ]);
  });

  it('writes the repository-relative aggregate id for a uniquely named aggregate', async () => {
    const dir = writeProject(TICKET_PROJECT);
    await run(['check', '--update-baseline', '--baseline', 'baseline.json'], captureIo(dir).io);

    expect(JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')).findings).toEqual([TICKET_ENTRY]);
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
