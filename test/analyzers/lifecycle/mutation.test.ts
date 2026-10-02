import { describe, expect, it } from 'vitest';
import { setsOf } from '../../../src/analyzers/lifecycle/assigned';
import { initialValues } from '../../../src/analyzers/lifecycle/initial';
import { mutatingMethods } from '../../../src/analyzers/lifecycle/mutation';
import { describeAssigned, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/account.ts': `
import { AggregateRoot } from './aggregate-root';
type AccountProps = { balance: number; closedAt: Date | null; items: string[] };
export class Account extends AggregateRoot<AccountProps> {
  private lockedAt: Date | null = null;
  private status: 'active' | 'frozen' = 'active';
  static open(): Account { return new Account({ balance: 0, closedAt: null, items: [] }); }
  balanceOf(): number { return this.props.balance; }
  deposit(amount: number): void { this.props.balance += amount; }
  addItem(item: string): void { this.props.items.push(item); }
  touch(): void { this.addEvent({ type: 'touched' }); }
  close(): void { this.props.closedAt = new Date(); }
  reopen(): void { this.props.closedAt = null; }
  closeViaHelper(): void { this.close(); }
  lock(): void { this.lockedAt = new Date(); }
  freeze(next: 'active' | 'frozen'): void { this.status = next; }
  freezeNow(): void { this.status = 'frozen'; }
  replaceAll(props: AccountProps): void { this.props = props; }
  count(): number { let n = 0; n += 1; return n; }
}
export class Assigned extends AggregateRoot<object> {
  private phase!: 'a' | 'b';
  constructor(input: { phase: 'a' | 'b' }) { super({}); Object.assign(this, input); }
}
export class Hydrated extends AggregateRoot<{ phase: 'a' | 'b' }> {}
type TamperProps = { closedAt: Date | null };
export class Tampering extends AggregateRoot<TamperProps> {
  coalesce(): void { this.props.closedAt ??= new Date(); }
  assignProps(): void { Object.assign(this.props, { closedAt: new Date() }); }
  destructure(): void { ({ closedAt: this.props.closedAt } = { closedAt: new Date() }); }
  alias(): void { const p = this.props; p.closedAt = new Date(); }
  bracketProps(props: TamperProps): void { this['props'] = props; }
  parenProps(props: TamperProps): void { (this.props) = props; }
  fluent(): this { return this; }
  publish(): void { this.addEvent({ order: this }); }
  serialise(): object { return { ...this }; }
}
export class ShorthandFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static create(status: 'a' | 'b'): ShorthandFactory { return new ShorthandFactory({ status }); }
}
export class VariableFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static from(input: { status: 'a' | 'b' }): VariableFactory { return new VariableFactory(input); }
}
export class SpreadFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static from(input: { status: 'a' | 'b' }): SpreadFactory { return new SpreadFactory({ ...input }); }
}
export class SpreadWithoutField extends AggregateRoot<{ title: string; status: 'a' | 'b' }> {
  static from(input: { title: string }): SpreadWithoutField { return new SpreadWithoutField({ ...input, status: 'a' }); }
}
export class SuperCaller extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  constructor(someParam: 'a' | 'b') { super({ status: someParam }); }
}
export class ThisFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static make(): ThisFactory { return new this({ status: 'b' }); }
}
export class RecordFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static from(input: Record<string, unknown>): RecordFactory { return new RecordFactory(input); }
}
export class UnionFactory extends AggregateRoot<object> {
  private status: 'a' | 'b' = 'a';
  static from(input: { status: 'b' } | { title: string }): UnionFactory { return new UnionFactory(input); }
}
class Money { add(other: Money): Money { return other; } }
export class Priced extends AggregateRoot<{ price: Money }> {
  reprice(other: Money): void { this.props.price.add(other); }
}
`,
});

const file = project.getSourceFileOrThrow('/src/account.ts');
const account = file.getClassOrThrow('Account');
const closedAt = resolvedField(account, 'closedAt');
const status = resolvedField(account, 'status');
const lockedAt = resolvedField(account, 'lockedAt');

describe('mutatingMethods', () => {
  it('finds assignments, collection changes, events and calls to mutating methods', () => {
    expect([...mutatingMethods(account.getInstanceMethods(), ['addEvent'])].sort()).toEqual([
      'addItem',
      'close',
      'closeViaHelper',
      'deposit',
      'freeze',
      'freezeNow',
      'lock',
      'reopen',
      'replaceAll',
      'touch',
    ]);
  });
});

describe('mutatingMethods on value objects', () => {
  it('ignores a collection-style call on a value object field', () => {
    expect([...mutatingMethods(file.getClassOrThrow('Priced').getInstanceMethods(), [])]).toEqual([]);
  });
});

describe('setsOf conservatism', () => {
  const tampering = file.getClassOrThrow('Tampering');
  const tamperedClosedAt = resolvedField(tampering, 'closedAt');

  it.each(['coalesce', 'destructure', 'bracketProps', 'parenProps'])('%s is unresolved', (method) => {
    expect(setsOf(tampering.getMethodOrThrow(method), tamperedClosedAt).unresolved).toBe(true);
  });

  it.each(['assignProps', 'alias'])('%s may write through an escape', (method) => {
    expect(describeAssigned(setsOf(tampering.getMethodOrThrow(method), tamperedClosedAt))).toEqual({
      tokens: [],
      unresolved: false,
      mayWrite: true,
    });
  });

  it.each(['fluent', 'publish', 'serialise'])('%s lets this escape without writing the field', (method) => {
    expect(describeAssigned(setsOf(tampering.getMethodOrThrow(method), tamperedClosedAt))).toEqual({
      tokens: [],
      unresolved: false,
      mayWrite: true,
    });
  });
});

describe('setsOf', () => {
  it.each([
    ['close', closedAt, { tokens: ['set'], unresolved: false, mayWrite: false }],
    ['reopen', closedAt, { tokens: ['unset'], unresolved: false, mayWrite: false }],
    ['freezeNow', status, { tokens: ['frozen'], unresolved: false, mayWrite: false }],
    ['freeze', status, { tokens: [], unresolved: true, mayWrite: false }],
    ['replaceAll', closedAt, { tokens: [], unresolved: true, mayWrite: false }],
    ['deposit', closedAt, { tokens: [], unresolved: false, mayWrite: false }],
  ] as const)('%s', (method, field, expected) => {
    expect(describeAssigned(setsOf(account.getMethodOrThrow(method), field))).toEqual(expected);
  });
});

describe('initialValues', () => {
  it('reads a property initializer', () => {
    expect(describeAssigned(initialValues(account, status))).toEqual({ tokens: ['active'], unresolved: false, mayWrite: false });
  });

  it('reads a null initializer as unset', () => {
    expect(describeAssigned(initialValues(account, lockedAt))).toEqual({ tokens: ['unset'], unresolved: false, mayWrite: false });
  });

  it('reads the value a static factory passes', () => {
    expect(describeAssigned(initialValues(account, closedAt))).toEqual({ tokens: ['unset'], unresolved: false, mayWrite: false });
  });

  it('treats Object.assign in the constructor as unresolved', () => {
    const assigned = file.getClassOrThrow('Assigned');

    expect(initialValues(assigned, resolvedField(assigned, 'phase')).unresolved).toBe(true);
  });

  it('treats an aggregate created only outside the class as unresolved', () => {
    const hydrated = file.getClassOrThrow('Hydrated');

    expect(initialValues(hydrated, resolvedField(hydrated, 'phase')).unresolved).toBe(true);
  });

  it.each(['ShorthandFactory', 'VariableFactory', 'SpreadFactory', 'SuperCaller', 'RecordFactory', 'UnionFactory'])('%s is unresolved', (name) => {
    const cls = file.getClassOrThrow(name);

    expect(initialValues(cls, resolvedField(cls, 'status')).unresolved).toBe(true);
  });

  it('includes the value passed through new this', () => {
    const cls = file.getClassOrThrow('ThisFactory');

    expect(describeAssigned(initialValues(cls, resolvedField(cls, 'status')))).toEqual({ tokens: ['a', 'b'], unresolved: false, mayWrite: false });
  });

  it('stays resolved when a spread value lacks the field', () => {
    const cls = file.getClassOrThrow('SpreadWithoutField');

    expect(describeAssigned(initialValues(cls, resolvedField(cls, 'status')))).toEqual({ tokens: ['a'], unresolved: false, mayWrite: false });
  });
});
