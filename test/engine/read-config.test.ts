import { CompilerOptions } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/engine/errors';
import { readDeclaration } from '../../src/engine/read-config';
import { AGGREGATE_ROOT, inMemoryProject } from '../helpers/in-memory';

const DOMAIN = {
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/order.ts': `
import { AggregateRoot } from './aggregate-root';
export enum OrderStatus { pending = 'PENDING', cancelled = 'CANCELLED' }
export class Order extends AggregateRoot<{ status: OrderStatus }> {
  cancel(): void { this.props.status = OrderStatus.cancelled; }
}
`,
};

const read = (config: string, compilerOptionOverrides: CompilerOptions = {}) => {
  const project = inMemoryProject({ ...DOMAIN, '/domain.config.ts': config }, compilerOptionOverrides);
  return readDeclaration(project.getSourceFileOrThrow('/domain.config.ts'));
};

describe('readDeclaration', () => {
  it('applies defaults when optional lists are omitted', () => {
    const declaration = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`);

    expect(declaration).toEqual({
      aggregateBaseClasses: ['AggregateRoot', 'Entity'],
      auditFields: ['createdAt', 'updatedAt', 'version'],
      eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
      inertMembers: [],
      lifecycles: [],
    });
  });

  it('resolves the class, enum values, transitions and exemptions of a lifecycle', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { cancel: [OrderStatus.pending] } } }, allowAfterTerminal: ['cancel'] })],
});
`).lifecycles;

    expect({
      target: order?.target.getName(),
      fields: order?.fields,
      allowAfterTerminal: order?.allowAfterTerminal,
    }).toEqual({
      target: 'Order',
      fields: [{ name: 'status', terminal: ['CANCELLED'], transitions: new Map([['cancel', ['PENDING']]]), allowAfterTerminal: [] }],
      allowAfterTerminal: ['cancel'],
    });
  });

  it('reads single terminal values for nullable and boolean fields', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { closedAt: { terminal: 'set' }, archived: { terminal: true } } })],
});
`).lifecycles;

    expect(order?.fields.map((field) => field.terminal)).toEqual([['set'], ['true']]);
  });

  it('reports type errors in the config as a ConfigError', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], transitions: { reopen: [] } } } })],
});
`),
    ).toThrow(/Type errors in domain.config.ts/);
  });

  it('requires a default export of defineDomain', () => {
    expect(() => read('export default {};')).toThrow(ConfigError);
  });

  it('rejects syntax it cannot read statically, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const lifecycles = [] as const;
export default defineDomain({ lifecycles });
`),
    ).toThrow(/domain.config.ts:4/);
  });

  it('ignores project-level diagnostics that do not belong to the config file', () => {
    const declaration = read(
      `
import { defineDomain } from 'domain-integrity';
export default defineDomain({});
`,
      { baseUrl: '/' },
    );

    expect(declaration.lifecycles).toEqual([]);
  });

  it('rejects a state field spec without terminal', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: {
    // @ts-expect-error
    status: {},
  } })],
});
`),
    ).toThrow(/needs "terminal"/);
  });

  it('rejects a state value that is not a literal', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order } from './src/order';
const value = 'x' as string;
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [value] } } })],
});
`),
    ).toThrow(/cannot resolve/);
  });

  it('defaults allowAfterTerminal to an empty list', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled] } } })],
});
`).lifecycles;

    expect(order?.allowAfterTerminal).toEqual([]);
  });

  it('reads allowAfterTerminal inside a state field', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], allowAfterTerminal: ['cancel'] } } })],
});
`).lifecycles;

    expect(order?.fields.map((field) => field.allowAfterTerminal)).toEqual([['cancel']]);
  });

  it('defaults a state field allowAfterTerminal to an empty list', () => {
    const [order] = read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled] } } })],
});
`).lifecycles;

    expect(order?.fields.map((field) => field.allowAfterTerminal)).toEqual([[]]);
  });

  it('rejects a state field allowAfterTerminal entry that is not a method', () => {
    expect(() =>
      read(`
import { defineDomain, lifecycle } from 'domain-integrity';
import { Order, OrderStatus } from './src/order';
export default defineDomain({
  lifecycles: [lifecycle(Order, { states: { status: { terminal: [OrderStatus.cancelled], allowAfterTerminal: ['nope'] } } })],
});
`),
    ).toThrow(ConfigError);
  });

  it('rejects a non-string entry in aggregateBaseClasses', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'Base' as string;
export default defineDomain({ aggregateBaseClasses: [name] });
`),
    ).toThrow(ConfigError);
  });

  it('reads inertMembers', () => {
    const declaration = read(`
import { defineDomain } from 'domain-integrity';
export default defineDomain({ inertMembers: ['id', 'clearDomainEvents'] });
`);

    expect(declaration.inertMembers).toEqual(['id', 'clearDomainEvents']);
  });

  it('rejects a non-string entry in inertMembers', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const name = 'id' as string;
export default defineDomain({ inertMembers: [name] });
`),
    ).toThrow(/expected a string literal/);
  });

  it('rejects inertMembers that is not an array literal, with the line', () => {
    expect(() =>
      read(`
import { defineDomain } from 'domain-integrity';
const names = ['id'];
export default defineDomain({ inertMembers: names });
`),
    ).toThrow(/domain.config.ts:4 expected an array literal/);
  });
});
