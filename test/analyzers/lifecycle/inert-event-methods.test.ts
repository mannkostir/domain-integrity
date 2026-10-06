import { ClassDeclaration, Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const REGISTRY = `
export class Registry {
  private static marked: { readonly id: string }[] = [];
  static mark(aggregate: { readonly id: string }): void {
    if (!Registry.marked.some((other) => other.id === aggregate.id)) Registry.marked.push(aggregate);
  }
}
export class Paid { constructor(readonly source: object) {} }
export class Noted { constructor(readonly note: string) {} }
export class Peeking { readonly label: string; constructor(source: { label(): string }) { this.label = source.label(); } }
`;

const FILES = {
  '/src/registry.ts': REGISTRY,
  '/src/root.ts': `
import { Registry } from './registry';
const sealed = <T>(target: T): T => target;
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); this.log(event); }
  private log(event: object): void { void Reflect.getPrototypeOf(this); void Reflect.getPrototypeOf(event); }
}
export abstract class ReassigningRoot {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor() { this.addDomainEvent = (event: object): void => { void event; }; }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
export abstract class AssigningRoot {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor(props: object) { Object.assign(this, props); }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
@sealed
export abstract class DecoratedRoot {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
export abstract class AccessorRoot {
  readonly id: string = 'id';
  private events: object[] = [];
  protected get addDomainEvent(): (event: object) => void { return (event) => { this.events.push(event); Registry.mark(this); }; }
}
`,
  '/src/payment.ts': `
import { AccessorRoot, AssigningRoot, DecoratedRoot, ReassigningRoot, Root } from './root';
import { Noted, Paid, Peeking } from './registry';
export type Status = 'open' | 'closed';
export class Payment extends Root {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  label(): string { return this.note; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
  record(n: string): void { this.note = n; this.addDomainEvent(new Noted(n)); }
  settle(n: string): void { this.note = n; super.addDomainEvent(new Paid(this)); }
  refund(n: string): void { if (this.status === 'closed') throw new Error('x'); this.note = n; this.addDomainEvent(new Paid(this)); }
  peek(n: string): void { this.note = n; this.addDomainEvent(new Peeking(this)); }
}
export class OverriddenPayment extends Root {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
export class LoudPayment extends OverriddenPayment {
  protected addDomainEvent = (event: object): void => { void event; };
}
export class ReassignedPayment extends ReassigningRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
export class AssignedPayment extends AssigningRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
export class DecoratedPayment extends DecoratedRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
export class AccessorPayment extends AccessorRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
`,
};

const BRACKET_FILES = {
  '/src/registry.ts': REGISTRY,
  '/src/root.ts': `
import { Registry } from './registry';
export abstract class BracketRoot {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor() { this['addDomainEvent'] = (event: object): void => { void event; }; }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`,
  '/src/payment.ts': `
import { BracketRoot } from './root';
import { Paid } from './registry';
export type Status = 'open' | 'closed';
export class BracketPayment extends BracketRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
`,
};

const defineProject = inMemoryProject(FILES, { useDefineForClassFields: true });
const assignProject = inMemoryProject(FILES, { useDefineForClassFields: false });
const bracketProject = inMemoryProject(BRACKET_FILES, { useDefineForClassFields: true });

const paymentClass = (project: Project, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow('/src/payment.ts').getClassOrThrow(name);

const leaks = (project: Project, target: ClassDeclaration, inertEventMethods: readonly string[]) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      inertEventMethods,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: project.getSourceFiles(),
    root: '/',
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method)
    .sort();
};

describe('event methods asserted inert', () => {
  it('leaves callers of a registering event method unjudged when it is not listed', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'Payment'), [])).toEqual([]);
  });

  it('judges callers through this and super when the event method is listed', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'Payment'), ['addDomainEvent'])).toEqual(['pay', 'record', 'settle']);
  });

  it('judges callers the same way when class fields use assignment semantics', () => {
    expect(leaks(assignProject, paymentClass(assignProject, 'Payment'), ['addDomainEvent'])).toEqual(['pay', 'record', 'settle']);
  });
});

describe('event methods that cannot be asserted inert', () => {
  it('ignores the entry when a project subclass redeclares the name as a field', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'OverriddenPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry for a subclass field under assignment semantics', () => {
    expect(leaks(assignProject, paymentClass(assignProject, 'OverriddenPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the method is reassigned on this', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'ReassignedPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the method is reassigned through a bracket key', () => {
    expect(leaks(bracketProject, paymentClass(bracketProject, 'BracketPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the family assigns onto this', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'AssignedPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a class in the family is decorated', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'DecoratedPayment'), ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the name is an accessor', () => {
    expect(leaks(defineProject, paymentClass(defineProject, 'AccessorPayment'), ['addDomainEvent'])).toEqual([]);
  });
});
