import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/run';
import { configSourceFile, loadProject } from '../../src/engine/project';
import { readDeclaration } from '../../src/engine/read-config';
import { TICKET_CONFIG, TICKET_SOURCES, captureIo, writeProject } from '../helpers/disk';

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
});
