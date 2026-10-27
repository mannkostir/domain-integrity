import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { run } from '../../src/cli/run';
import { configSourceFile, loadProject } from '../../src/engine/project';
import { readDeclaration } from '../../src/engine/read-config';
import { HAS_POSIX_FILE_MODES, TICKET_CONFIG, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';
import { declarationIn, initWithBaseClass, readConfig } from '../helpers/init-project';
import { FOUR_SPACE_CONFIG, MODEL_SOURCES, PAYMENT, baseClassSource, invoiceExtending, orderWithEnumIn } from '../helpers/init-sources';

const orderIn = (status: string) => `
import { AggregateRoot } from '../aggregate-root';
export class Order extends AggregateRoot<{ state: 'open' | '${status}' }> {
  static open(): Order { return new Order({ state: 'open' }); }
  finish(): void { if (this.props.state === '${status}') return; this.props.state = '${status}'; }
}
`;

const SHIPMENT_EXTENDING_RECORD = `
import { Record } from './record';
export class Shipment extends Record<{ state: 'pending' | 'delivered' }> {
  static pending(): Shipment { return new Shipment({ state: 'pending' }); }
  deliver(): void { if (this.props.state === 'delivered') return; this.props.state = 'delivered'; }
}
`;

const CONFIG_WITH_TYPE_ERROR_ON_LINE_6 = `import { defineDomain } from 'domain-integrity';

export default defineDomain({
  lifecycles: [],
});
export const broken: number = 'text';
`;

const TOUCHABLE_AGGREGATE_ROOT = AGGREGATE_ROOT.replace(
  '  protected addEvent(',
  '  private version = 0;\n\n  touch(): void {\n    this.version += 1;\n  }\n\n  protected addEvent(',
);

const ORDER_CONFIG = `import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';

export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { state: { terminal: ['paid'] } } })],
});
`;

const MIXED_BASE_PROJECT = {
  ...MODEL_SOURCES,
  'src/aggregate-root.ts': TOUCHABLE_AGGREGATE_ROOT,
  'src/order.ts': orderIn('paid').replace("'../aggregate-root'", "'./aggregate-root'"),
  'domain.config.ts': ORDER_CONFIG,
};

const declaredBaseClasses = (dir: string): readonly string[] => declarationIn(dir).aggregateBaseClasses;

describe('init --base-class', () => {
  it('declares an aggregate extending the named base class', async () => {
    const dir = writeProject(MODEL_SOURCES);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("    lifecycle(Invoice, {\n      states: {\n        state: { terminal: 'void' },\n      },\n    }),\n");
  });

  it('records the named base class in the written config', async () => {
    const dir = writeProject(MODEL_SOURCES);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect({
      text: readConfig(dir).includes("aggregates: { baseClasses: ['Model'] }"),
      declared: declaredBaseClasses(dir),
    }).toEqual({ text: true, declared: ['Model'] });
  });

  it('writes new base classes under aggregates', async () => {
    const dir = await initWithBaseClass(undefined);

    expect(readConfig(dir)).toContain("aggregates: { baseClasses: ['Model'] }");
  });

  it('adds base classes inside an existing aggregates group', async () => {
    const dir = await initWithBaseClass("import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ aggregates: { auditFields: ['stamp'] }, lifecycles: [] });\n");

    expect({
      groups: readConfig(dir).split('aggregates:').length - 1,
      baseClasses: declarationIn(dir).aggregateBaseClasses,
      auditFields: declarationIn(dir).auditFields,
    }).toEqual({ groups: 1, baseClasses: ['AggregateRoot', 'Entity', 'Model'], auditFields: ['stamp'] });
  });

  it('adds base classes inside an aggregates group whose key is quoted', async () => {
    const dir = await initWithBaseClass("import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ 'aggregates': { auditFields: ['stamp'] }, lifecycles: [] });\n");

    expect({
      groups: readConfig(dir).split('aggregates').length - 1,
      baseClasses: declarationIn(dir).aggregateBaseClasses,
    }).toEqual({ groups: 1, baseClasses: ['AggregateRoot', 'Entity', 'Model'] });
  });

  it('appends to a quoted baseClasses key inside the aggregates group', async () => {
    const dir = await initWithBaseClass("import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ aggregates: { 'baseClasses': ['Legacy'] }, lifecycles: [] });\n");

    expect({
      keys: readConfig(dir).split('baseClasses').length - 1,
      baseClasses: declarationIn(dir).aggregateBaseClasses,
    }).toEqual({ keys: 1, baseClasses: ['Legacy', 'Model'] });
  });

  it('appends to a quoted old base class key', async () => {
    const dir = await initWithBaseClass("import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ 'aggregateBaseClasses': ['Legacy'], lifecycles: [] });\n");

    expect({
      keys: readConfig(dir).split('aggregateBaseClasses').length - 1,
      baseClasses: declarationIn(dir).aggregateBaseClasses,
    }).toEqual({ keys: 1, baseClasses: ['Legacy', 'Model'] });
  });

  it('appends to the old base class option when the config uses it', async () => {
    const dir = await initWithBaseClass("import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ aggregateBaseClasses: ['Legacy'], lifecycles: [] });\n");

    expect({ text: readConfig(dir).includes("aggregateBaseClasses: ['Legacy', 'Model']"), grouped: readConfig(dir).includes('aggregates:') }).toEqual({ text: true, grouped: false });
  });

  it('lets check find the leak of an aggregate discovered through the named base class', async () => {
    const dir = writeProject(MODEL_SOURCES);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });

  it('declares aggregates of every repeated base class and records each name', async () => {
    const dir = writeProject({
      ...MODEL_SOURCES,
      'src/record.ts': baseClassSource('Record'),
      'src/shipment.ts': SHIPMENT_EXTENDING_RECORD,
    });
    await run(['init', '--yes', '--base-class', 'Model', '--base-class', 'Record'], captureIo(dir).io);
    const config = readConfig(dir);

    expect({
      invoice: config.includes('lifecycle(Invoice, '),
      shipment: config.includes('lifecycle(Shipment, '),
      declared: declaredBaseClasses(dir),
    }).toEqual({ invoice: true, shipment: true, declared: ['Model', 'Record'] });
  });

  it('appends the named base class to the base classes an existing config lists', async () => {
    const dir = writeProject({
      ...MODEL_SOURCES,
      'domain.config.ts':
        "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ aggregateBaseClasses: ['Legacy'], lifecycles: [] });\n",
    });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(declaredBaseClasses(dir)).toEqual(['Legacy', 'Model']);
  });

  it('adds the named base class to the default base classes of an existing config that lists none', async () => {
    const dir = writeProject({ ...MODEL_SOURCES, 'domain.config.ts': FOUR_SPACE_CONFIG });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(declaredBaseClasses(dir)).toEqual(['AggregateRoot', 'Entity', 'Model']);
  });

  it('keeps a declared aggregate clean of its default base class methods in an existing config', async () => {
    const dir = writeProject(MIXED_BASE_PROJECT);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);
    const { io, stdout } = captureIo(dir);
    await run(['check', '--format', 'json'], io);

    expect(stdout()).not.toContain('"aggregate": "Order"');
  });

  it('still declares an undeclared aggregate extending a default base class in an existing config', async () => {
    const dir = writeProject({ ...MIXED_BASE_PROJECT, 'src/payment.ts': PAYMENT });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toContain('lifecycle(Payment, ');
  });

  it('records the default base classes before the named one in an existing config that lists none', async () => {
    const dir = writeProject(MIXED_BASE_PROJECT);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(declaredBaseClasses(dir)).toEqual(['AggregateRoot', 'Entity', 'Model']);
  });

  it('keeps the four-space indentation of an existing config when recording the base class', async () => {
    const dir = writeProject({
      ...MODEL_SOURCES,
      'domain.config.ts': FOUR_SPACE_CONFIG,
    });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("\n    aggregates: { baseClasses: ['AggregateRoot', 'Entity', 'Model'] },\n    lifecycles: [");
  });

  it('keeps the two-space indentation of an existing config when recording the base class', async () => {
    const dir = writeProject({
      ...MODEL_SOURCES,
      'domain.config.ts': FOUR_SPACE_CONFIG.replace('    lifecycles', '  lifecycles'),
    });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("\n  aggregates: { baseClasses: ['AggregateRoot', 'Entity', 'Model'] },\n  lifecycles: [");
  });

  it('reports a type error of an existing config at the line the user wrote', async () => {
    const dir = writeProject({ ...MODEL_SOURCES, 'domain.config.ts': CONFIG_WITH_TYPE_ERROR_ON_LINE_6 });
    const withoutFlag = captureIo(dir);
    const withFlag = captureIo(dir);
    await run(['init', '--yes'], withoutFlag.io);
    await run(['init', '--yes', '--base-class', 'Model'], withFlag.io);

    expect({
      withoutFlag: withoutFlag.stderr().includes('domain.config.ts:6 '),
      withFlag: withFlag.stderr().includes('domain.config.ts:6 '),
    }).toEqual({ withoutFlag: true, withFlag: true });
  });

  it('names the config passed with -c in its type errors', async () => {
    const { io, stderr } = captureIo(writeProject({ ...MODEL_SOURCES, 'configs/my.config.ts': CONFIG_WITH_TYPE_ERROR_ON_LINE_6 }));
    await run(['init', '--yes', '-c', 'configs/my.config.ts'], io);

    expect(stderr()).toBe("Type errors in configs/my.config.ts:\nconfigs/my.config.ts:6 Type 'string' is not assignable to type 'number'.\n");
  });

  it('exits 2 and writes nothing for a base class that is not an identifier', async () => {
    const dir = writeProject(MODEL_SOURCES);
    const exitCode = await run(['init', '--yes', '--base-class', 'Not valid'], captureIo(dir).io);

    expect({ exitCode, written: existsSync(join(dir, 'domain.config.ts')) }).toEqual({ exitCode: 2, written: false });
  });

  it('declares an aggregate extending a base class with a non-ASCII name', async () => {
    const dir = writeProject({
      'src/modell.ts': baseClassSource('Модель'),
      'src/invoice.ts': invoiceExtending('Модель', 'modell'),
    });
    await run(['init', '--yes', '--base-class', 'Модель'], captureIo(dir).io);

    expect(readConfig(dir)).toContain('lifecycle(Invoice, ');
  });

  it('names the rejected base class in the error', async () => {
    const dir = writeProject(MODEL_SOURCES);
    const { io, stderr } = captureIo(dir);
    await run(['init', '--yes', '--base-class', 'Not valid'], io);

    expect(stderr()).toContain('"Not valid"');
  });

  it('leaves the base classes out of the config when the option is not given', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).not.toContain('aggregateBaseClasses');
  });
});

const INVOICE_CONFIG = `import { defineDomain, lifecycle } from 'domain-integrity';
import { Invoice } from './src/invoice';

export default defineDomain({
  lifecycles: [lifecycle(Invoice, { states: { state: { terminal: ['void'] } } })],
});
`;

const STATELESS_MODEL_SOURCES = {
  'src/model.ts': baseClassSource('Model'),
  'src/note.ts': "import { Model } from './model';\nexport class Note extends Model<{ text: string }> {}\n",
};

describe('init --base-class when nothing is declared', () => {
  it('explains that the base classes were not saved when no aggregate has a state field', async () => {
    const dir = writeProject(STATELESS_MODEL_SOURCES);
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes', '--base-class', 'Model'], io);

    expect(stdout()).toBe(
      "No state fields found in the discovered aggregates; nothing to declare.\nNo config was written to domain.config.ts, so the --base-class names were not saved. For check to find the same aggregates, add aggregates: { baseClasses: ['Model'] } to defineDomain({...}) in domain.config.ts yourself.\n",
    );
  });

  it('explains that the base classes were not saved when every aggregate is already declared', async () => {
    const dir = writeProject({ ...MODEL_SOURCES, 'domain.config.ts': INVOICE_CONFIG });
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes', '--base-class', 'Model'], io);

    expect(stdout()).toBe(
      "All discovered aggregates are already declared.\nNo config was written to domain.config.ts, so the --base-class names were not saved. For check to find the same aggregates, add aggregates: { baseClasses: ['AggregateRoot', 'Entity', 'Model'] } to defineDomain({...}) in domain.config.ts yourself.\n",
    );
  });

  it('explains that the base classes were not saved when every suggestion is declined', async () => {
    const dir = writeProject(MODEL_SOURCES);
    const { io, stdout } = captureIo(dir, ['n']);
    await run(['init', '--base-class', 'Model'], io);

    expect(stdout()).toMatch(
      /Nothing declared\.\nNo config was written to domain\.config\.ts, so the --base-class names were not saved\. For check to find the same aggregates, add aggregates: \{ baseClasses: \['Model'\] \} to defineDomain\(\{\.\.\.\}\) in domain\.config\.ts yourself\.\n$/,
    );
  });

  it('leaves an existing config untouched when every aggregate is already declared', async () => {
    const dir = writeProject({ ...MODEL_SOURCES, 'domain.config.ts': INVOICE_CONFIG });
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toBe(INVOICE_CONFIG);
  });

  it('keeps the message without the option unchanged when no aggregate has a state field', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': AGGREGATE_ROOT,
      'src/note.ts': "import { AggregateRoot } from './aggregate-root';\nexport class Note extends AggregateRoot<{ text: string }> {}\n",
    });
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes'], io);

    expect(stdout()).toBe('No state fields found in the discovered aggregates; nothing to declare.\n');
  });
});

const NO_AGGREGATE_SOURCES = { 'src/a.ts': 'export const a = 1;\n' };

const noAggregateSourcesIn = (dir: string) => ({
  [`${dir}/tsconfig.json`]: JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
  [`${dir}/src/a.ts`]: 'export const a = 1;\n',
});

const NESTED_NO_AGGREGATE_SOURCES = noAggregateSourcesIn('sub');

describe('init without aggregates', () => {
  it('ends with the init command to run with the default paths', async () => {
    const { io, stderr } = captureIo(writeProject(NO_AGGREGATE_SOURCES));
    await run(['init', '--yes'], io);

    expect(stderr()).toMatch(/: npx domain-integrity init --base-class <Name> --yes\n$/);
  });

  it('keeps the searched base classes in the message', async () => {
    const { io, stderr } = captureIo(writeProject(NO_AGGREGATE_SOURCES));
    await run(['init', '--yes'], io);

    expect(stderr()).toContain('No aggregates found. Searched for classes extending or implementing: AggregateRoot, Entity.');
  });

  it('tells the user to repeat the option for every base class', async () => {
    const { io, stderr } = captureIo(writeProject(NO_AGGREGATE_SOURCES));
    await run(['init', '--yes'], io);

    expect(stderr()).toContain('repeating --base-class for each one');
  });

  it('leaves --yes out of the command when it was not given', async () => {
    const { io, stderr } = captureIo(writeProject(NO_AGGREGATE_SOURCES), ['y']);
    await run(['init'], io);

    expect(stderr()).toMatch(/: npx domain-integrity init --base-class <Name>\n$/);
  });

  it('includes the project and config paths relative to the working directory when they are not the defaults', async () => {
    const { io, stderr } = captureIo(writeProject(NESTED_NO_AGGREGATE_SOURCES));
    await run(['init', '--yes', '-p', 'sub/tsconfig.json', '-c', 'sub/domain.config.ts'], io);

    expect(stderr()).toMatch(
      /: npx domain-integrity init --base-class <Name> -p sub\/tsconfig\.json -c sub\/domain\.config\.ts --yes\n$/,
    );
  });

  it('single-quotes project and config paths that contain a space', async () => {
    const { io, stderr } = captureIo(writeProject(noAggregateSourcesIn('my sub')));
    await run(['init', '--yes', '-p', 'my sub/tsconfig.json', '-c', 'my sub/domain.config.ts'], io);

    expect(stderr()).toMatch(/ -p 'my sub\/tsconfig\.json' -c 'my sub\/domain\.config\.ts' --yes\n$/);
  });

  it('escapes a single quote inside a quoted path', async () => {
    const { io, stderr } = captureIo(writeProject(noAggregateSourcesIn("it's")));
    await run(['init', '--yes', '-p', "it's/tsconfig.json"], io);

    expect(stderr()).toContain(" -p 'it'\\''s/tsconfig.json' ");
  });

  it('exits 2 and writes no config', async () => {
    const dir = writeProject(NO_AGGREGATE_SOURCES);
    const exitCode = await run(['init', '--yes'], captureIo(dir).io);

    expect({ exitCode, written: existsSync(join(dir, 'domain.config.ts')) }).toEqual({ exitCode: 2, written: false });
  });
});

const configImporting = (ticketImport: string): string => `import { defineDomain } from 'domain-integrity';
${ticketImport}
export default defineDomain({ lifecycles: [] });
`;

const NAMESPACE_IMPORT_CONFIG = configImporting("import * as tickets from './src/ticket';");

const TYPE_ONLY_IMPORT_CONFIG = configImporting("import type { TicketStatus } from './src/ticket';");

describe('init beside an import of the aggregate module', () => {
  it('adds a separate import when the module is imported as a namespace', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': NAMESPACE_IMPORT_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir).split('\n').filter((line) => line.startsWith('import'))).toEqual([
      "import { defineDomain, lifecycle } from 'domain-integrity';",
      "import * as tickets from './src/ticket';",
      "import { Ticket, TicketStatus } from './src/ticket';",
    ]);
  });

  it('writes a config that check reads when the module is imported as a namespace', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': NAMESPACE_IMPORT_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });

  it('imports values beside a type-only import of the module', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': TYPE_ONLY_IMPORT_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir).split('\n').filter((line) => line.startsWith('import'))).toEqual([
      "import { defineDomain, lifecycle } from 'domain-integrity';",
      "import type { TicketStatus } from './src/ticket';",
      "import { Ticket, TicketStatus as TicketStatus2 } from './src/ticket';",
    ]);
  });

  it('writes a config that check reads when the module is imported for types only', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': TYPE_ONLY_IMPORT_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });
});

const SHIPMENT_SOURCES = {
  'src/aggregate-root.ts': AGGREGATE_ROOT,
  'src/shipment.ts': `
import { AggregateRoot } from './aggregate-root';
export enum ShipmentStage { packed = 'PACKED', sent = 'SENT' }
export class Shipment extends AggregateRoot<{ stage: ShipmentStage | null }> {
  static pack(): Shipment { return new Shipment({ stage: ShipmentStage.packed }); }
  send(): void { if (this.props.stage === null) return; this.props.stage = ShipmentStage.sent; }
  cancel(): void { this.props.stage = null; }
}
`,
};

describe('init for an enum field that may be null', () => {
  it('suggests the unset value as the terminal state', async () => {
    const dir = writeProject(SHIPMENT_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("stage: { terminal: 'unset' },");
  });

  it('imports only the aggregate when no enum member is written', async () => {
    const dir = writeProject(SHIPMENT_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir).split('\n').filter((line) => line.startsWith('import'))).toEqual([
      "import { defineDomain, lifecycle } from 'domain-integrity';",
      "import { Shipment } from './src/shipment';",
    ]);
  });

  it('writes a config that check reads', async () => {
    const dir = writeProject(SHIPMENT_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });
});

describe('init', () => {
  it('writes a config that check can read', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });

  it('writes a config whose declared lifecycle targets are the suggested aggregates', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'), dir);
    const { declaration } = readDeclaration(configSourceFile(project, join(dir, 'domain.config.ts'), dir), 'domain.config.ts');

    expect(declaration.lifecycles.map((lifecycle) => lifecycle.target.getName())).toEqual(['Ticket']);
  });

  it('declares the suggested terminal state with a real enum import', () => {
    const dir = writeProject(TICKET_SOURCES);

    return run(['init', '--yes'], captureIo(dir).io).then(() =>
      expect(readConfig(dir)).toMatch(
        /import \{ Ticket, TicketStatus \} from '\.\/src\/ticket';[\s\S]*lifecycle\(Ticket, \{\n {6}states: \{\n {8}status: \{ terminal: TicketStatus\.closed \},/,
      ),
    );
  });

  it('adds only undeclared aggregates and keeps existing declarations byte for byte', async () => {
    const edited = TICKET_CONFIG.replace('terminal: [TicketStatus.closed]', 'terminal: []');
    const dir = writeProject({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': edited });
    await run(['init', '--yes'], captureIo(dir).io);
    const config = readConfig(dir);

    expect({
      keptTicket: config.includes("lifecycle(Ticket, { states: { status: { terminal: [] } } })"),
      addedPayment: config.includes("  lifecycle(Payment, {\n    states: {\n      state: { terminal: 'paid' },\n    },\n  }),\n"),
      ticketCount: config.split('lifecycle(Ticket').length - 1,
    }).toEqual({ keptTicket: true, addedPayment: true, ticketCount: 1 });
  });

  it('adds the import of a new aggregate to an existing config in single quotes', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': TICKET_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Payment } from './src/payment';");
  });

  it('reports when every aggregate is already declared', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': TICKET_CONFIG });
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes'], io);

    expect(stdout()).toBe('All discovered aggregates are already declared.\n');
  });

  it('reports when no discovered aggregate has a state field', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
      'src/note.ts': "import { AggregateRoot } from './aggregate-root';\nexport class Note extends AggregateRoot<{ text: string }> {}\n",
    });
    const { io, stdout } = captureIo(dir);
    await run(['init', '--yes'], io);

    expect({ stdout: stdout(), written: existsSync(join(dir, 'domain.config.ts')) }).toEqual({
      stdout: 'No state fields found in the discovered aggregates; nothing to declare.\n',
      written: false,
    });
  });

  it('writes nothing when the only suggestion is declined', async () => {
    const dir = writeProject(TICKET_SOURCES);
    const { io, stdout } = captureIo(dir, ['n']);
    await run(['init'], io);

    expect(stdout()).toBe('Nothing declared.\n');
  });

  it('refuses to prompt without a terminal', async () => {
    const dir = writeProject(TICKET_SOURCES);
    const { io, stderr } = captureIo(dir);
    await run(['init'], io);

    expect({ mentionsYes: stderr().includes('pass --yes'), written: existsSync(join(dir, 'domain.config.ts')) }).toEqual({
      mentionsYes: true,
      written: false,
    });
  });

  it('exits 2 when a suggestion needs confirming without a terminal', async () => {
    const dir = writeProject(TICKET_SOURCES);

    const exitCode = await run(['init'], captureIo(dir).io);

    expect(exitCode).toBe(2);
  });

  it('reports every aggregate as declared without a terminal', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': TICKET_CONFIG });
    const { io, stdout } = captureIo(dir);

    const exitCode = await run(['init'], io);

    expect({ exitCode, stdout: stdout() }).toEqual({ exitCode: 0, stdout: 'All discovered aggregates are already declared.\n' });
  });

  it('reports no state fields without a terminal', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
      'src/note.ts': "import { AggregateRoot } from './aggregate-root';\nexport class Note extends AggregateRoot<{ text: string }> {}\n",
    });
    const { io, stdout } = captureIo(dir);

    const exitCode = await run(['init'], io);

    expect({ exitCode, stdout: stdout() }).toEqual({
      exitCode: 0,
      stdout: 'No state fields found in the discovered aggregates; nothing to declare.\n',
    });
  });

  it('explains the unsaved base classes without a terminal when nothing is left to declare', async () => {
    const dir = writeProject(STATELESS_MODEL_SOURCES);
    const { io, stdout } = captureIo(dir);

    const exitCode = await run(['init', '--base-class', 'Model'], io);

    expect({ exitCode, stdout: stdout() }).toEqual({
      exitCode: 0,
      stdout:
        "No state fields found in the discovered aggregates; nothing to declare.\nNo config was written to domain.config.ts, so the --base-class names were not saved. For check to find the same aggregates, add aggregates: { baseClasses: ['Model'] } to defineDomain({...}) in domain.config.ts yourself.\n",
    });
  });

  it('creates no config with --base-class when a suggestion needs confirming without a terminal', async () => {
    const dir = writeProject(MODEL_SOURCES);

    await run(['init', '--base-class', 'Model'], captureIo(dir).io);

    expect(existsSync(join(dir, 'domain.config.ts'))).toBe(false);
  });

  it('leaves an existing config untouched with --base-class when a suggestion needs confirming without a terminal', async () => {
    const dir = writeProject(MIXED_BASE_PROJECT);

    await run(['init', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toBe(ORDER_CONFIG);
  });

  it('exits 2 with a clear message when the config cannot be read', async () => {
    const dir = writeProject(TICKET_SOURCES);
    mkdirSync(join(dir, 'domain.config.ts'));
    const { io, stderr } = captureIo(dir);

    expect({ exitCode: await run(['init', '--yes'], io), mentionsCannot: stderr().includes('Cannot') }).toEqual({
      exitCode: 2,
      mentionsCannot: true,
    });
  });

  it('reports a config path that is a directory as unreadable', async () => {
    const dir = writeProject(TICKET_SOURCES);
    mkdirSync(join(dir, 'domain.config.ts'));
    const { io, stderr } = captureIo(dir);
    await run(['init', '--yes'], io);

    expect(stderr()).toBe('Cannot read domain.config.ts: it is a directory\n');
  });

  it('reports a config path that is a directory as unreadable with --base-class', async () => {
    const dir = writeProject(MODEL_SOURCES);
    mkdirSync(join(dir, 'domain.config.ts'));
    const { io, stderr } = captureIo(dir);

    expect({ exitCode: await run(['init', '--yes', '--base-class', 'Model'], io), stderr: stderr() }).toEqual({
      exitCode: 2,
      stderr: 'Cannot read domain.config.ts: it is a directory\n',
    });
  });

  it.runIf(HAS_POSIX_FILE_MODES)('reports an existing config without read permission as unreadable', async () => {
    const dir = writeProject({ ...TICKET_SOURCES, 'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({ lifecycles: [] });\n" });
    chmodSync(join(dir, 'domain.config.ts'), 0o000);
    onTestFinished(() => chmodSync(join(dir, 'domain.config.ts'), 0o644));
    const { io, stderr } = captureIo(dir);

    expect({ exitCode: await run(['init', '--yes'], io), stderr: stderr() }).toEqual({
      exitCode: 2,
      stderr: 'Cannot read domain.config.ts: permission denied\n',
    });
  });

  it.runIf(HAS_POSIX_FILE_MODES)('names the config that cannot be saved relative to the working directory', async () => {
    const dir = writeProject(TICKET_SOURCES);
    mkdirSync(join(dir, 'configs'), { mode: 0o555 });
    onTestFinished(() => chmodSync(join(dir, 'configs'), 0o755));
    const { io, stderr } = captureIo(dir);

    expect({ exitCode: await run(['init', '--yes', '-c', 'configs/domain.config.ts'], io), stderr: stderr() }).toEqual({
      exitCode: 2,
      stderr: 'Cannot write configs/domain.config.ts: permission denied\n',
    });
  });

  it('does not duplicate an import the config already binds', async () => {
    const dir = writeProject({
      ...TICKET_SOURCES,
      'domain.config.ts':
        "import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Ticket, TicketStatus } from './src/ticket.js';\nexport default defineDomain({ lifecycles: [] });\n",
    });
    const exitCode = await run(['init', '--yes'], captureIo(dir).io);

    expect({
      exitCode,
      ticketImports: readConfig(dir).split('import { Ticket').length - 1,
      check: await run(['check'], captureIo(dir).io),
    }).toEqual({ exitCode: 0, ticketImports: 1, check: 1 });
  });

  it('declares same-named aggregates from different files under distinct aliases', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
      'src/sales/order.ts': orderIn('paid'),
      'src/shipping/order.ts': orderIn('shipped'),
    });
    await run(['init', '--yes'], captureIo(dir).io);
    const config = readConfig(dir);

    expect({
      sales: config.includes("import { Order } from './src/sales/order';"),
      shipping: config.includes("import { Order as Order2 } from './src/shipping/order';"),
      salesLifecycle: config.includes("    lifecycle(Order, {\n      states: {\n        state: { terminal: 'paid' },\n"),
      shippingLifecycle: config.includes("    lifecycle(Order2, {\n      states: {\n        state: { terminal: 'shipped' },\n"),
      check: await run(['check'], captureIo(dir).io),
    }).toEqual({ sales: true, shipping: true, salesLifecycle: true, shippingLifecycle: true, check: 0 });
  });

  it('aliases a same-named state enum together with its aggregate', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
      'src/sales/order.ts': orderWithEnumIn('paid'),
      'src/shipping/order.ts': orderWithEnumIn('shipped'),
    });
    await run(['init', '--yes'], captureIo(dir).io);
    const config = readConfig(dir);

    expect({
      shipping: config.includes("import { Order as Order2, OrderStatus as OrderStatus2 } from './src/shipping/order';"),
      shippingLifecycle: config.includes('    lifecycle(Order2, {\n      states: {\n        status: { terminal: OrderStatus2.shipped },\n'),
      check: await run(['check'], captureIo(dir).io),
    }).toEqual({ shipping: true, shippingLifecycle: true, check: 0 });
  });

  it('aliases an aggregate whose name the config already binds to another file', async () => {
    const dir = writeProject({
      'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
      'src/sales/order.ts': orderIn('paid'),
      'src/legacy.ts': 'export class Order {}\n',
      'domain.config.ts':
        "import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Order } from './src/legacy';\nexport default defineDomain({ lifecycles: [] });\n",
    });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain('lifecycle(Order2, ');
  });

  it('adds the lifecycle import to a hand-written config that lacks it', async () => {
    const dir = writeProject({
      ...TICKET_SOURCES,
      'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n",
    });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { defineDomain, lifecycle } from 'domain-integrity';");
  });

  it('indents the lifecycles it adds to an empty hand-written config with two spaces', async () => {
    const dir = writeProject({
      ...TICKET_SOURCES,
      'domain.config.ts': "import { defineDomain } from 'domain-integrity';\nexport default defineDomain({});\n",
    });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain('defineDomain({\n  lifecycles: [\n    lifecycle(');
  });

  it('writes runtime extensions when the project resolves modules as NodeNext', async () => {
    const dir = writeProject(TICKET_SOURCES, { module: 'NodeNext', moduleResolution: 'NodeNext' });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.js';");
  });

  it('writes runtime extensions when the project resolves modules as Node16', async () => {
    const dir = writeProject(TICKET_SOURCES, { module: 'Node16', moduleResolution: 'Node16' });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.js';");
  });

  it('writes runtime extensions when NodeNext resolution is implied by the module setting', async () => {
    const dir = writeProject(TICKET_SOURCES, { module: 'NodeNext', moduleResolution: undefined });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.js';");
  });

  it('writes the mjs extension for an aggregate in an mts file under NodeNext', async () => {
    const dir = writeProject(
      { 'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'], 'src/ticket.mts': TICKET_SOURCES['src/ticket.ts'] },
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.mjs';");
  });

  it('keeps the index file name for an aggregate in a directory index under NodeNext', async () => {
    const dir = writeProject(
      {
        'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
        'src/ticket/index.ts': TICKET_SOURCES['src/ticket.ts'].replace("'./aggregate-root'", "'../aggregate-root'"),
      },
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket/index.js';");
  });

  it('imports an enum declared in a declaration file from its runtime path under NodeNext', async () => {
    const dir = writeProject(
      {
        'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'],
        'src/ticket-status.d.ts': "export declare enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }\n",
        'src/ticket.ts': TICKET_SOURCES['src/ticket.ts'].replace(
          "export enum TicketStatus { open = 'OPEN', closed = 'CLOSED' }",
          "import { TicketStatus } from './ticket-status.js';",
        ),
      },
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { TicketStatus } from './src/ticket-status.js';");
  });

  it('writes the cjs extension for an aggregate in a cts file under NodeNext', async () => {
    const dir = writeProject(
      { 'src/aggregate-root.ts': TICKET_SOURCES['src/aggregate-root.ts'], 'src/ticket.cts': TICKET_SOURCES['src/ticket.ts'] },
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.cjs';");
  });

  it('writes a parent-relative runtime path for a config outside the project root under NodeNext', async () => {
    const dir = writeProject(TICKET_SOURCES, { module: 'NodeNext', moduleResolution: 'NodeNext' });
    await run(['init', '--yes', '-c', 'config/domain.config.ts'], captureIo(dir).io);

    expect(readFileSync(join(dir, 'config/domain.config.ts'), 'utf8')).toContain(
      "import { Ticket, TicketStatus } from '../src/ticket.js';",
    );
  });

  it('extends an existing runtime-extension import under NodeNext instead of adding another', async () => {
    const dir = writeProject(
      {
        ...TICKET_SOURCES,
        'domain.config.ts':
          "import { defineDomain, lifecycle } from 'domain-integrity';\nimport { Ticket } from './src/ticket.js';\nexport default defineDomain({ lifecycles: [] });\n",
      },
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );
    await run(['init', '--yes'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("import { Ticket, TicketStatus } from './src/ticket.js';");
  });
});
