import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { DEFAULT_DECLARATION, DeclaredField } from '../../../src/engine/declaration';
import { describeAssigned, describeSources } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', cancelled = 'CANCELLED' }
export class Order extends AggregateRoot<{ status: OrderStatus; updatedAt: Date | null }> {
  static create(): Order { return new Order({ status: OrderStatus.pending, updatedAt: null }); }
  cancel(): void {
    if (this.props.status === OrderStatus.cancelled) return;
    this.props.status = OrderStatus.cancelled;
    this.props.updatedAt = new Date();
  }
}
`,
  '/src/payment.ts': `
import { AggregateRoot } from './aggregate-root';
export class Payment extends AggregateRoot<{ state: 'open' | 'paid'; amount: number; updatedAt: Date | null }> {
  pay(): void { this.props.state = 'paid'; this.props.updatedAt = new Date(); }
}
`,
  '/src/shipment.ts': `
import { AggregateRoot } from './aggregate-root';
export enum ShipmentStatus { packed = 'PACKED', sent = 'SENT' }
export class Shipment extends AggregateRoot<{ status: ShipmentStatus }> {}
`,
  '/src/ledger.ts': `
import { AggregateRoot } from './aggregate-root';
export class Ledger extends AggregateRoot<{ open: boolean }> {
  close(): void { this.props.open = false; }
  protected onClosed(): void { this.props.open = false; }
  private onReopened(): void { this.props.open = true; }
  #onArchived(): void { this.props.open = false; }
}
`,
  '/src/dispatch.ts': `
import { ShipmentStatus } from './shipment';
export const dispatched = { status: ShipmentStatus.sent };
`,
});

const order = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

const extractWith = (fields: readonly DeclaredField[]) =>
  extractLifecycles({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: order, fields, allowAfterTerminal: [] }] },
    files: project.getSourceFiles(),
    root: '/',
  });

const aggregateNamed = (name: string, fields: readonly DeclaredField[]) =>
  extractWith(fields).aggregates.find((aggregate) => aggregate.name === name);

const STATUS: DeclaredField = {
  name: 'status',
  terminal: ['CANCELLED'],
  transitions: new Map([['cancel', ['PENDING']]]),
  allowAfterTerminal: [],
};

describe('extractLifecycles', () => {
  it('records the declared terminal states and transitions', () => {
    const declaration = aggregateNamed('Order', [STATUS])?.declarations.get('status');

    expect({
      terminal: [...(declaration?.terminal ?? [])],
      transitions: [...(declaration?.transitions ?? [])].map(([method, sources]) => [method, [...sources]]),
    }).toEqual({ terminal: ['CANCELLED'], transitions: [['cancel', ['PENDING']]] });
  });

  it('extracts each method behaviour for a declared field', () => {
    const cancel = aggregateNamed('Order', [STATUS])?.methods.find((method) => method.name === 'cancel');
    const behaviour = cancel?.fields.get('status');

    expect({
      mutates: cancel?.mutates,
      sources: behaviour && describeSources(behaviour.sources),
      sets: behaviour && describeAssigned(behaviour.sets),
    }).toEqual({ mutates: true, sources: ['PENDING'], sets: { tokens: ['CANCELLED'], unresolved: false, mayWrite: false } });
  });

  it('records the visibility of each method', () => {
    const methods = aggregateNamed('Ledger', [STATUS])?.methods.map((method) => [method.name, method.visibility]);

    expect(methods).toEqual([
      ['close', 'public'],
      ['onClosed', 'protected'],
      ['onReopened', 'private'],
      ['#onArchived', 'private'],
    ]);
  });

  it('records mentioned tokens for each declared field', () => {
    expect([...(aggregateNamed('Order', [STATUS])?.mentioned.keys() ?? [])]).toEqual(['status']);
  });

  it('records a mention made in another file for a declared field', () => {
    const shipment = project.getSourceFileOrThrow('/src/shipment.ts').getClassOrThrow('Shipment');
    const model = extractLifecycles({
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: shipment, fields: [{ name: 'status', terminal: [], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
      },
      files: project.getSourceFiles(),
      root: '/',
    });

    expect([...(model.aggregates.find((aggregate) => aggregate.name === 'Shipment')?.mentioned.get('status') ?? [])]).toEqual(['SENT']);
  });

  it('gives an undeclared aggregate no mentions', () => {
    expect(aggregateNamed('Payment', [STATUS])?.mentioned.size).toBe(0);
  });

  it('gives an undeclared aggregate no outside assignments', () => {
    expect(aggregateNamed('Payment', [STATUS])?.outside).toEqual([]);
  });

  it('gives undeclared aggregates candidate fields without audit or non-state fields', () => {
    expect(aggregateNamed('Payment', [STATUS])?.fields.map((field) => field.name)).toEqual(['state']);
  });

  it('reports unknown values, missing methods and missing fields as problems', () => {
    const { problems } = extractWith([
      { name: 'status', terminal: ['ARCHIVED'], transitions: new Map([['reopen', ['PENDING']]]), allowAfterTerminal: [] },
      { name: 'missing', terminal: [], transitions: undefined, allowAfterTerminal: [] },
    ]);

    expect(problems).toEqual([
      'Order.status: unknown state value "ARCHIVED" (known: PENDING, CANCELLED)',
      'Order: transitions refer to missing method "reopen"',
      'Order has no field "missing"',
    ]);
  });
});

describe('extractLifecycles aggregate ids', () => {
  const duplicated = inMemoryProject({
    '/src/aggregate-root.ts': AGGREGATE_ROOT,
    '/src/a/order.ts': `
import { AggregateRoot } from '../aggregate-root';
export class Order extends AggregateRoot<{ open: boolean }> {}
`,
    '/src/b/order.ts': `
import { AggregateRoot } from '../aggregate-root';
export class Order extends AggregateRoot<{ open: boolean }> {}
`,
    '/src/invoice.ts': `
import { AggregateRoot } from './aggregate-root';
export class Invoice extends AggregateRoot<{ open: boolean }> {}
`,
  });

  const { aggregates } = extractLifecycles({ declaration: DEFAULT_DECLARATION, files: duplicated.getSourceFiles(), root: '/' });

  it('qualifies aggregates that share a class name with their relative path', () => {
    expect(aggregates.filter((aggregate) => aggregate.name === 'Order').map((aggregate) => aggregate.id).sort()).toEqual([
      'src/a/order.ts:Order',
      'src/b/order.ts:Order',
    ]);
  });

  it('identifies an aggregate with a unique class name by that name', () => {
    expect(aggregates.find((aggregate) => aggregate.name === 'Invoice')?.id).toBe('Invoice');
  });

  it('always gives an aggregate a path qualified name', () => {
    expect(aggregates.find((aggregate) => aggregate.name === 'Invoice')?.qualifiedName).toBe('src/invoice.ts:Invoice');
  });
});
