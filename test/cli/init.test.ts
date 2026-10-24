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

const declarationIn = (dir: string) =>
  readDeclaration(configSourceFile(loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts')), join(dir, 'domain.config.ts'))).declaration;

const declaredBaseClasses = (dir: string): readonly string[] => declarationIn(dir).aggregateBaseClasses;

const initWithBaseClass = async (config: string | undefined): Promise<string> => {
  const dir = writeProject(config === undefined ? MODEL_SOURCES : { ...MODEL_SOURCES, 'domain.config.ts': config });
  await run(['init', '--yes', '--base-class', 'Model'], captureIo(dir).io);
  return dir;
};

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
    const { io, stdout } = captureIo(dir, [false]);
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

const INVITATION = `
import { AggregateRoot } from './aggregate-root';
export class Invitation extends AggregateRoot<{ state: 'pending' | 'accepted' | 'rejected' }> {
  static send(): Invitation { return new Invitation({ state: 'pending' }); }
  accept(): void { if (this.props.state !== 'pending') return; this.props.state = 'accepted'; }
  reject(): void { if (this.props.state !== 'pending') return; this.props.state = 'rejected'; }
}
`;

const SWITCH = `
import { AggregateRoot } from './aggregate-root';
export class Switch extends AggregateRoot<{ state: 'on' | 'off' }> {
  static off(): Switch { return new Switch({ state: 'off' }); }
  turnOn(): void { if (this.props.state === 'on') return; this.props.state = 'on'; }
  turnOff(): void { if (this.props.state === 'off') return; this.props.state = 'off'; }
}
`;

const TAB_CONFIG = `import { defineDomain } from 'domain-integrity';

export default defineDomain({
\tlifecycles: [],
});
`;

const textOf = (...lines: readonly string[]): string => `${lines.join('\n')}\n`;

const TICKET_CONFIG_HEADER = [
  "import { defineDomain, lifecycle } from 'domain-integrity';",
  "import { Ticket, TicketStatus } from './src/ticket';",
];

const SINGLE_LINE_LIFECYCLES_CONFIG = textOf(
  ...TICKET_CONFIG_HEADER,
  '',
  'export default defineDomain({',
  '  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }) /* reviewed */],',
  '});',
);

const MULTI_LINE_LIFECYCLES_CONFIG = textOf(
  ...TICKET_CONFIG_HEADER,
  '',
  'export default defineDomain({',
  '  lifecycles: [',
  '    // reviewed by the support team',
  '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })',
  '  ],',
  '});',
);

const TRAILING_COMMENT_LIFECYCLES_CONFIG = textOf(
  ...TICKET_CONFIG_HEADER,
  '',
  'export default defineDomain({',
  '  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }), /* more to come */],',
  '});',
);

const PAYMENT_LIFECYCLE_LINES = [
  '    lifecycle(Payment, {',
  '      states: {',
  "        state: { terminal: 'paid' },",
  '      },',
  '    }),',
];

const NOTICE = `
import { AggregateRoot } from './aggregate-root';
export class Notice extends AggregateRoot<{ state: 'draft' | 'say "done"' }> {
  static draft(): Notice { return new Notice({ state: 'draft' }); }
  finish(): void { if (this.props.state === 'say "done"') return; this.props.state = 'say "done"'; }
}
`;

const withCrlf = (text: string): string => text.replace(/\n/g, '\r\n');

const TICKET_LIFECYCLE_LINES = [
  '    lifecycle(Ticket, {',
  '      states: {',
  '        status: { terminal: TicketStatus.closed },',
  '      },',
  '    }),',
];

const configWithLifecycles = (...lifecycleLines: readonly string[]): string =>
  textOf(...TICKET_CONFIG_HEADER, '', 'export default defineDomain({', ...lifecycleLines, '});');

const editedTicketConfig = (...lifecycleLines: readonly string[]): string =>
  textOf(...TICKET_CONFIG_HEADER, "import { Payment } from './src/payment';", '', 'export default defineDomain({', ...lifecycleLines, '});');

const SPREAD_SINGLE_LINE_RESULT = editedTicketConfig(
  '  lifecycles: [',
  '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }) /* reviewed */,',
  ...PAYMENT_LIFECYCLE_LINES,
  '  ],',
);

const APPENDED_MULTI_LINE_RESULT = editedTicketConfig(
  '  lifecycles: [',
  '    // reviewed by the support team',
  '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
  ...PAYMENT_LIFECYCLE_LINES,
  '  ],',
);

const BRACKET_AFTER_LAST_LIFECYCLE_CONFIG = configWithLifecycles(
  '  lifecycles: [lifecycle(Ticket, {',
  '    states: { status: { terminal: [TicketStatus.closed] } },',
  '  })],',
);

const BRACKET_AFTER_LAST_LIFECYCLE_RESULT = editedTicketConfig(
  '  lifecycles: [lifecycle(Ticket, {',
  '    states: { status: { terminal: [TicketStatus.closed] } },',
  '  }),',
  ...PAYMENT_LIFECYCLE_LINES,
  '  ],',
);

const DOUBLE_QUOTED_CONFIG = textOf('import { defineDomain } from "domain-integrity";', '', 'export default defineDomain({', '  lifecycles: [],', '});');

const SINGLE_QUOTED_CONFIG = textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain({', '  lifecycles: [],', '});');

const noticeFinishingAs = (literal: string): string => `
import { AggregateRoot } from './aggregate-root';
export class Notice extends AggregateRoot<{ state: 'draft' | ${literal} }> {
  static draft(): Notice { return new Notice({ state: 'draft' }); }
  finish(): void { if (this.props.state === ${literal}) return; this.props.state = ${literal}; }
}
`;

const LEVEL = `
import { AggregateRoot } from './aggregate-root';
export class Level extends AggregateRoot<{ level: 1 | 2 }> {
  static start(): Level { return new Level({ level: 1 }); }
  finish(): void { if (this.props.level === 2) return; this.props.level = 2; }
}
`;

const configWithMixedQuotes = (...imports: readonly string[]): string =>
  textOf(
    ...imports,
    '',
    'export default defineDomain({',
    '  lifecycles: [lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } })],',
    '});',
  );

const doubleQuotedResult =(aggregateImport: string, ...lifecycleLines: readonly string[]): string =>
  textOf('import { defineDomain, lifecycle } from "domain-integrity";', aggregateImport, '', 'export default defineDomain({', '  lifecycles: [', ...lifecycleLines, '  ],', '});');

const ticketOnlyResult = (...configLines: readonly string[]): string =>
  textOf("import { defineDomain, lifecycle } from 'domain-integrity';", "import { Ticket, TicketStatus } from './src/ticket';", '', 'export default defineDomain({', ...configLines, '});');

const initIn = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const dir = writeProject(files);
  await run(['init', '--yes'], captureIo(dir).io);
  return readConfig(dir);
};

describe('init config layout', () => {
  it('writes a single terminal value of a new config as a scalar on its own line', async () => {
    const config = await initIn(TICKET_SOURCES);

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
  lifecycles: [
    lifecycle(Ticket, {
      states: {
        status: { terminal: TicketStatus.closed },
      },
    }),
  ],
});
`);
  });

  it('writes several terminal values as an array', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/invitation.ts': INVITATION });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Invitation } from './src/invitation';

export default defineDomain({
  lifecycles: [
    lifecycle(Invitation, {
      states: {
        state: { terminal: ['accepted', 'rejected'] },
      },
    }),
  ],
});
`);
  });

  it('writes a field without terminal values as an empty array', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/switch.ts': SWITCH });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Switch } from './src/switch';

export default defineDomain({
  lifecycles: [
    lifecycle(Switch, {
      states: {
        state: { terminal: [] },
      },
    }),
  ],
});
`);
  });

  it('nests with four spaces in a four-space config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'domain.config.ts': FOUR_SPACE_CONFIG });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
    lifecycles: [
        lifecycle(Ticket, {
            states: {
                status: { terminal: TicketStatus.closed },
            },
        }),
    ],
});
`);
  });

  it('nests with tabs in a tab-indented config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'domain.config.ts': TAB_CONFIG });

    expect(config).toBe(`import { defineDomain, lifecycle } from 'domain-integrity';
import { Ticket, TicketStatus } from './src/ticket';

export default defineDomain({
\tlifecycles: [
\t\tlifecycle(Ticket, {
\t\t\tstates: {
\t\t\t\tstatus: { terminal: TicketStatus.closed },
\t\t\t},
\t\t}),
\t],
});
`);
  });

  it('spreads a single-line lifecycles array over lines and keeps the existing element text', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': SINGLE_LINE_LIFECYCLES_CONFIG });

    expect(config).toBe(SPREAD_SINGLE_LINE_RESULT);
  });

  it('keeps a comment after the trailing comma of a single-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': TRAILING_COMMENT_LIFECYCLES_CONFIG });

    expect(config).toBe(
      textOf(
        ...TICKET_CONFIG_HEADER,
        "import { Payment } from './src/payment';",
        '',
        'export default defineDomain({',
        '  lifecycles: [',
        '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
        '    /* more to come */',
        ...PAYMENT_LIFECYCLE_LINES,
        '  ],',
        '});',
      ),
    );
  });

  it('appends to a multi-line lifecycles array and keeps its comment', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': MULTI_LINE_LIFECYCLES_CONFIG });

    expect(config).toBe(APPENDED_MULTI_LINE_RESULT);
  });
});

describe('init config layout of an existing config', () => {
  it('keeps CRLF line endings when spreading a single-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(SINGLE_LINE_LIFECYCLES_CONFIG) });

    expect(config).toBe(withCrlf(SPREAD_SINGLE_LINE_RESULT));
  });

  it('keeps CRLF line endings when appending to a multi-line lifecycles array', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(MULTI_LINE_LIFECYCLES_CONFIG) });

    expect(config).toBe(withCrlf(APPENDED_MULTI_LINE_RESULT));
  });

  it('keeps the text of a multi-line lifecycle in a CRLF config', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': withCrlf(BRACKET_AFTER_LAST_LIFECYCLE_CONFIG) });

    expect(config).toBe(withCrlf(BRACKET_AFTER_LAST_LIFECYCLE_RESULT));
  });

  it('keeps CRLF line endings when recording a base class', async () => {
    const withLf = await initWithBaseClass(FOUR_SPACE_CONFIG);
    const withCrLf = await initWithBaseClass(withCrlf(FOUR_SPACE_CONFIG));

    expect(readConfig(withCrLf)).toBe(withCrlf(readConfig(withLf)));
  });

  it('writes new imports and terminal values in the double quotes of the config', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/payment.ts': PAYMENT, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toBe(
      doubleQuotedResult(
        'import { Payment } from "./src/payment";',
        '    lifecycle(Payment, {',
        '      states: {',
        '        state: { terminal: "paid" },',
        '      },',
        '    }),',
      ),
    );
  });

  it('writes recorded base classes in the double quotes of the config', async () => {
    const dir = await initWithBaseClass(DOUBLE_QUOTED_CONFIG);

    expect(readConfig(dir)).toBe(
      textOf(
        'import { defineDomain, lifecycle } from "domain-integrity";',
        'import { Invoice } from "./src/invoice";',
        '',
        'export default defineDomain({',
        '  aggregates: { baseClasses: ["AggregateRoot", "Entity", "Model"] },',
        '  lifecycles: [',
        '    lifecycle(Invoice, {',
        '      states: {',
        '        state: { terminal: "void" },',
        '      },',
        '    }),',
        '  ],',
        '});',
      ),
    );
  });

  it('escapes a double quote inside a terminal value written in double quotes', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toBe(
      doubleQuotedResult(
        'import { Notice } from "./src/notice";',
        '    lifecycle(Notice, {',
        '      states: {',
        '        state: { terminal: "say \\"done\\"" },',
        '      },',
        '    }),',
      ),
    );
  });

  it('escapes a single quote inside a terminal value written in single quotes', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE.replace(/say "done"/g, `it\\'s "done"`) });

    expect(config).toContain(`state: { terminal: 'it\\'s "done"' },`);
  });

  it('writes a config with an escaped terminal value that check reads', async () => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes an escaped terminal value that reads back as the value of the state', async () => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': NOTICE, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(declarationIn(dir).lifecycles[0]?.fields[0]?.terminal).toEqual(['say "done"']);
  });

  it.each([
    ['a backslash', 'single-quoted', '"it\'s\\\\done"', "it's\\done", SINGLE_QUOTED_CONFIG],
    ['a backslash', 'double-quoted', '"it\'s\\\\done"', "it's\\done", DOUBLE_QUOTED_CONFIG],
    ['a line break', 'single-quoted', "'line\\nbreak'", 'line\nbreak', SINGLE_QUOTED_CONFIG],
    ['a line break', 'double-quoted', "'line\\nbreak'", 'line\nbreak', DOUBLE_QUOTED_CONFIG],
  ])('writes a terminal value with %s that reads back as the value of the state in a %s config', async (_, __, literal, value, config) => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': noticeFinishingAs(literal), 'domain.config.ts': config });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(declarationIn(dir).lifecycles[0]?.fields[0]?.terminal).toEqual([value]);
  });

  it.each([
    ['a backslash', 'single-quoted', '"it\'s\\\\done"', SINGLE_QUOTED_CONFIG],
    ['a backslash', 'double-quoted', '"it\'s\\\\done"', DOUBLE_QUOTED_CONFIG],
    ['a line break', 'single-quoted', "'line\\nbreak'", SINGLE_QUOTED_CONFIG],
    ['a line break', 'double-quoted', "'line\\nbreak'", DOUBLE_QUOTED_CONFIG],
  ])('writes a terminal value with %s that check reads in a %s config', async (_, __, literal, config) => {
    const dir = writeProject({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/notice.ts': noticeFinishingAs(literal), 'domain.config.ts': config });
    await run(['init', '--yes'], captureIo(dir).io);

    expect(await run(['check'], captureIo(dir).io)).toBe(0);
  });

  it('writes a numeric terminal value unquoted', async () => {
    const config = await initIn({ 'src/aggregate-root.ts': AGGREGATE_ROOT, 'src/level.ts': LEVEL, 'domain.config.ts': DOUBLE_QUOTED_CONFIG });

    expect(config).toContain('        level: { terminal: 2 },\n');
  });

  it('nests relative to the line of a config object that opens on its own line', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain(', '  {', '    lifecycles: [],', '  },', ');'),
    });

    expect(config).toBe(
      textOf(
        "import { defineDomain, lifecycle } from 'domain-integrity';",
        "import { Ticket, TicketStatus } from './src/ticket';",
        '',
        'export default defineDomain(',
        '  {',
        '    lifecycles: [',
        '      lifecycle(Ticket, {',
        '        states: {',
        '          status: { terminal: TicketStatus.closed },',
        '        },',
        '      }),',
        '    ],',
        '  },',
        ');',
      ),
    );
  });

  it('writes in the quotes most imports use when the first import uses the other kind', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configWithMixedQuotes(
        "import { defineDomain, lifecycle } from 'domain-integrity';",
        'import { Ticket } from "./src/ticket";',
        'import { TicketStatus } from "./src/ticket";',
      ),
    });

    expect(config).toContain('import { Payment } from "./src/payment";');
  });

  it('writes in the quotes of the imports when a single-quoted directive comes first', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configWithMixedQuotes(
        "'use strict';",
        'import { defineDomain, lifecycle } from "domain-integrity";',
        'import { Ticket, TicketStatus } from "./src/ticket";',
      ),
    });

    expect(config).toContain('import { Payment } from "./src/payment";');
  });

  it('keeps LF line endings in a config whose last line alone ends in CRLF', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': MULTI_LINE_LIFECYCLES_CONFIG.replace(/\n$/, '\r\n'),
    });

    expect(config).toBe(APPENDED_MULTI_LINE_RESULT.replace(/\n$/, '\r\n'));
  });

  it('appends to a lifecycles array whose key is quoted', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain({', "  'lifecycles': [],", '});'),
    });

    expect(config).toBe(ticketOnlyResult("  'lifecycles': [", ...TICKET_LIFECYCLE_LINES, '  ],'));
  });

  it('puts new lifecycles after a comment that shares the line of the closing bracket', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configWithLifecycles(
        '  lifecycles: [',
        '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
        '  /* end */ ],',
      ),
    });

    expect(config).toBe(
      editedTicketConfig(
        '  lifecycles: [',
        '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
        '  /* end */',
        ...PAYMENT_LIFECYCLE_LINES,
        '  ],',
      ),
    );
  });

  it('puts the closing bracket on its own line when it followed the last lifecycle', async () => {
    const config = await initIn({ ...TICKET_SOURCES, 'src/payment.ts': PAYMENT, 'domain.config.ts': BRACKET_AFTER_LAST_LIFECYCLE_CONFIG });

    expect(config).toBe(BRACKET_AFTER_LAST_LIFECYCLE_RESULT);
  });

  it('appends to a multi-line lifecycles array that already ends in a trailing comma', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'src/payment.ts': PAYMENT,
      'domain.config.ts': configWithLifecycles(
        '  lifecycles: [',
        '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
        '  ],',
      ),
    });

    expect(config).toBe(
      editedTicketConfig(
        '  lifecycles: [',
        '    lifecycle(Ticket, { states: { status: { terminal: [TicketStatus.closed] } } }),',
        ...PAYMENT_LIFECYCLE_LINES,
        '  ],',
      ),
    );
  });

  it('fills an empty multi-line lifecycles array', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain({', '  lifecycles: [', '  ],', '});'),
    });

    expect(config).toBe(ticketOnlyResult('  lifecycles: [', ...TICKET_LIFECYCLE_LINES, '  ],'));
  });

  it('adds a lifecycles property to a config that has none', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain({', "  aggregates: { auditFields: ['stamp'] },", '});'),
    });

    expect(config).toBe(ticketOnlyResult("  aggregates: { auditFields: ['stamp'] },", '  lifecycles: [', ...TICKET_LIFECYCLE_LINES, '  ]'));
  });

  it('nests relative to the line of a lifecycles property that does not start it', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain({', "  aggregates: { auditFields: ['stamp'] }, lifecycles: [],", '});'),
    });

    expect(config).toBe(ticketOnlyResult("  aggregates: { auditFields: ['stamp'] }, lifecycles: [", ...TICKET_LIFECYCLE_LINES, '  ],'));
  });

  it('nests with two spaces when the config does not show its indentation', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", 'export default defineDomain({ lifecycles: [] });'),
    });

    expect(config).toBe(
      textOf(
        "import { defineDomain, lifecycle } from 'domain-integrity';",
        "import { Ticket, TicketStatus } from './src/ticket';",
        '',
        'export default defineDomain({ lifecycles: [',
        '  lifecycle(Ticket, {',
        '    states: {',
        '      status: { terminal: TicketStatus.closed },',
        '    },',
        '  }),',
        '] });',
      ),
    );
  });

  it('nests with two spaces when the first property shares an indented line with the opening brace', async () => {
    const config = await initIn({
      ...TICKET_SOURCES,
      'domain.config.ts': textOf("import { defineDomain } from 'domain-integrity';", '', 'export default defineDomain(', '    { lifecycles: [] },', ');'),
    });

    expect(config).toBe(
      textOf(
        "import { defineDomain, lifecycle } from 'domain-integrity';",
        "import { Ticket, TicketStatus } from './src/ticket';",
        '',
        'export default defineDomain(',
        '    { lifecycles: [',
        '      lifecycle(Ticket, {',
        '        states: {',
        '          status: { terminal: TicketStatus.closed },',
        '        },',
        '      }),',
        '    ] },',
        ');',
      ),
    );
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
    const project = loadProject(join(dir, 'tsconfig.json'), join(dir, 'domain.config.ts'));
    const { declaration } = readDeclaration(configSourceFile(project, join(dir, 'domain.config.ts')));

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
