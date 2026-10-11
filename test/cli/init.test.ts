import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { configSourceFile, loadProject } from '../../src/engine/project';
import { readDeclaration } from '../../src/engine/read-config';
import { TICKET_CONFIG, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';
import { AGGREGATE_ROOT } from '../helpers/in-memory';

const readConfig = (dir: string): string => readFileSync(join(dir, 'domain.config.ts'), 'utf8');

const PAYMENT = `
import { AggregateRoot } from './aggregate-root';
export class Payment extends AggregateRoot<{ state: 'open' | 'paid' }> {
  static open(): Payment { return new Payment({ state: 'open' }); }
  pay(): void { if (this.props.state === 'paid') return; this.props.state = 'paid'; }
}
`;

const orderIn = (status: string) => `
import { AggregateRoot } from '../aggregate-root';
export class Order extends AggregateRoot<{ state: 'open' | '${status}' }> {
  static open(): Order { return new Order({ state: 'open' }); }
  finish(): void { if (this.props.state === '${status}') return; this.props.state = '${status}'; }
}
`;

const orderWithEnumIn = (status: string) => `
import { AggregateRoot } from '../aggregate-root';
export enum OrderStatus { open = 'OPEN', ${status} = '${status.toUpperCase()}' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  static open(): Order { return new Order({ status: OrderStatus.open }); }
  finish(): void { if (this.props.status === OrderStatus.${status}) return; this.props.status = OrderStatus.${status}; }
}
`;

const baseClassSource = (name: string): string => AGGREGATE_ROOT.replace('class AggregateRoot<', `class ${name}<`);

const invoiceExtending = (base: string, file: string) => `
import { ${base} } from './${file}';
export class Invoice extends ${base}<{ state: 'draft' | 'void'; note: string }> {
  static draft(note: string): Invoice { return new Invoice({ state: 'draft', note }); }
  annotate(note: string): void { this.props.note = note; }
  cancel(): void { if (this.props.state === 'void') return; this.props.state = 'void'; }
}
`;

const SHIPMENT_EXTENDING_RECORD = `
import { Record } from './record';
export class Shipment extends Record<{ state: 'pending' | 'delivered' }> {
  static pending(): Shipment { return new Shipment({ state: 'pending' }); }
  deliver(): void { if (this.props.state === 'delivered') return; this.props.state = 'delivered'; }
}
`;

const MODEL_SOURCES = {
  'src/model.ts': baseClassSource('Model'),
  'src/invoice.ts': invoiceExtending('Model', 'model'),
};

const FOUR_SPACE_CONFIG = `import { defineDomain } from 'domain-integrity';

export default defineDomain({
    lifecycles: [],
});
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

const declaredBaseClasses = (dir: string): readonly string[] =>
  readDeclaration(configSourceFile(loadProject(join(dir, 'tsconfig.json')), join(dir, 'domain.config.ts'))).aggregateBaseClasses;

describe('init --base-class', () => {
  it('declares an aggregate extending the named base class', async () => {
    const dir = writeProject(MODEL_SOURCES);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect(readConfig(dir)).toContain("lifecycle(Invoice, { states: { state: { terminal: ['void'] } } })");
  });

  it('records the named base class in the written config', async () => {
    const dir = writeProject(MODEL_SOURCES);
    await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);

    expect({
      text: readConfig(dir).includes("aggregateBaseClasses: ['Model']"),
      declared: declaredBaseClasses(dir),
    }).toEqual({ text: true, declared: ['Model'] });
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

    expect(readConfig(dir)).toContain("\n    aggregateBaseClasses: ['AggregateRoot', 'Entity', 'Model'],\n    lifecycles: [");
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

  it('exits 2 and writes nothing for a base class that is not an identifier', async () => {
    const dir = writeProject(MODEL_SOURCES);
    const exitCode = await run(['init', '--yes', '--base-class', 'Not valid'], captureIo(dir).io);

    expect({ exitCode, written: existsSync(join(dir, 'domain.config.ts')) }).toEqual({ exitCode: 2, written: false });
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
    const { io, stderr } = captureIo(writeProject(NO_AGGREGATE_SOURCES), [true]);
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

describe('init', () => {
  it('writes a config that check can read', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(1);
  });

  it('writes a config whose declared lifecycle targets are the suggested aggregates', async () => {
    const dir = writeProject(TICKET_SOURCES);
    await run(['init', '--yes'], captureIo(dir).io);
    const project = loadProject(join(dir, 'tsconfig.json'));
    const declaration = readDeclaration(configSourceFile(project, join(dir, 'domain.config.ts')));

    expect(declaration.lifecycles.map((lifecycle) => lifecycle.target.getName())).toEqual(['Ticket']);
  });

  it('declares the suggested terminal state with a real enum import', () => {
    const dir = writeProject(TICKET_SOURCES);

    return run(['init', '--yes'], captureIo(dir).io).then(() =>
      expect(readConfig(dir)).toMatch(
        /import \{ Ticket, TicketStatus \} from '\.\/src\/ticket';[\s\S]*lifecycle\(Ticket, \{ states: \{ status: \{ terminal: \[TicketStatus\.closed\] \} \} \}\)/,
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
      addedPayment: config.includes("lifecycle(Payment, { states: { state: { terminal: ['paid'] } } })"),
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
    const { io, stdout } = captureIo(dir, [false]);
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

  it('exits 2 with a clear message when the config cannot be written', async () => {
    const dir = writeProject(TICKET_SOURCES);
    mkdirSync(join(dir, 'domain.config.ts'));
    const { io, stderr } = captureIo(dir);

    expect({ exitCode: await run(['init', '--yes'], io), mentionsCannot: stderr().includes('Cannot') }).toEqual({
      exitCode: 2,
      mentionsCannot: true,
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
      salesLifecycle: config.includes("lifecycle(Order, { states: { state: { terminal: ['paid'] } } })"),
      shippingLifecycle: config.includes("lifecycle(Order2, { states: { state: { terminal: ['shipped'] } } })"),
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
      shippingLifecycle: config.includes('lifecycle(Order2, { states: { status: { terminal: [OrderStatus2.shipped] } } })'),
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
