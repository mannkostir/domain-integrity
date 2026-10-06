import { CompilerOptions, Project } from 'ts-morph';
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

const DEFINE: CompilerOptions = { useDefineForClassFields: true };
const ASSIGN: CompilerOptions = { useDefineForClassFields: false };

const projectWith = (rootSource: string, paymentSource: string, options: CompilerOptions): Project =>
  inMemoryProject({ '/src/registry.ts': REGISTRY, '/src/root.ts': rootSource, '/src/payment.ts': paymentSource }, options);

const REGISTERING_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); this.log(event); }
  private log(event: object): void { void Reflect.getPrototypeOf(this); void Reflect.getPrototypeOf(event); }
}
`;

const JUDGED_PAYMENT = `
import { Root } from './root';
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
`;

const PLAIN_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const REASSIGNING_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor() { this.addDomainEvent = (event: object): void => { void event; }; }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const BRACKET_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor() { this['addDomainEvent'] = (event: object): void => { void event; }; }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const ASSIGNING_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  constructor(props: object) { Object.assign(this, props); }
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const DECORATED_ROOT = `
import { Registry } from './registry';
const sealed = <T>(target: T): T => target;
@sealed
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const ACCESSOR_ROOT = `
import { Registry } from './registry';
export abstract class Root {
  readonly id: string = 'id';
  private events: object[] = [];
  protected get addDomainEvent(): (event: object) => void { return (event) => { this.events.push(event); Registry.mark(this); }; }
}
`;

const UNRESOLVED_ROOT = `
import { Lib } from 'missing-lib';
import { Registry } from './registry';
export abstract class Root extends Lib {
  readonly id: string = 'id';
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); Registry.mark(this); }
}
`;

const PAYMENT = `
import { Root } from './root';
import { Paid } from './registry';
export type Status = 'open' | 'closed';
export class Payment extends Root {
  protected status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Paid(this)); }
}
`;

const FIELD_SUBCLASS = `
export class LoudPayment extends Payment {
  protected addDomainEvent = (event: object): void => { void event; };
}
`;

const CLASS_EXPRESSION_SUBCLASS = `
export const Sub = class extends Payment {
  protected addDomainEvent = (event: object): void => { if (this.status === 'closed') throw new Error('x'); void event; };
};
`;

const COMPUTED_KEY_SUBCLASS = `
const K = 'addDomainEvent';
export class LoudPayment extends Payment {
  [K] = (event: object): void => { if (this.status === 'closed') throw new Error('x'); void event; };
}
`;

const OPEN_KEY_SUBCLASS = `
declare const key: string;
export class LoudPayment extends Payment {
  [key] = (event: object): void => { if (this.status === 'closed') throw new Error('x'); void event; };
}
`;

const ASSIGNING_CLASS_EXPRESSION = `
export const Guarded = class extends Payment {
  constructor() {
    super();
    const self = this;
    Object.assign(this, { addDomainEvent(event: object): void { if (self.status === 'closed') throw new Error('x'); void event; } });
  }
};
`;

const DECORATED_CLASS_EXPRESSION = `
const replace = <T>(target: T, context: unknown): T => { void context; return target; };
export const Guarded = @replace class extends Payment {};
`;

const MIXIN = `
export function Loud<T extends new (...args: any[]) => object>(Base: T) {
  return class extends Base { addDomainEvent = (event: object): void => { void event; }; };
}
export const LoudPayment = Loud(Payment);
`;

const PROTOTYPE_WRITE = `
Payment.prototype.addDomainEvent = (event: object): void => { void event; };
`;

const judgedDefine = projectWith(REGISTERING_ROOT, JUDGED_PAYMENT, DEFINE);
const judgedAssign = projectWith(REGISTERING_ROOT, JUDGED_PAYMENT, ASSIGN);
const plain = projectWith(PLAIN_ROOT, PAYMENT, DEFINE);
const fieldSubclassDefine = projectWith(PLAIN_ROOT, PAYMENT + FIELD_SUBCLASS, DEFINE);
const fieldSubclassAssign = projectWith(PLAIN_ROOT, PAYMENT + FIELD_SUBCLASS, ASSIGN);
const reassigned = projectWith(REASSIGNING_ROOT, PAYMENT, DEFINE);
const bracket = projectWith(BRACKET_ROOT, PAYMENT, DEFINE);
const assigning = projectWith(ASSIGNING_ROOT, PAYMENT, DEFINE);
const decorated = projectWith(DECORATED_ROOT, PAYMENT, DEFINE);
const classExpression = projectWith(PLAIN_ROOT, PAYMENT + CLASS_EXPRESSION_SUBCLASS, DEFINE);
const mixin = projectWith(PLAIN_ROOT, PAYMENT + MIXIN, DEFINE);
const prototypeWrite = projectWith(PLAIN_ROOT, PAYMENT + PROTOTYPE_WRITE, DEFINE);
const accessor = projectWith(ACCESSOR_ROOT, PAYMENT, DEFINE);
const computedKey = projectWith(PLAIN_ROOT, PAYMENT + COMPUTED_KEY_SUBCLASS, DEFINE);
const openKey = projectWith(PLAIN_ROOT, PAYMENT + OPEN_KEY_SUBCLASS, DEFINE);
const assigningClassExpression = projectWith(PLAIN_ROOT, PAYMENT + ASSIGNING_CLASS_EXPRESSION, DEFINE);
const decoratedClassExpression = projectWith(PLAIN_ROOT, PAYMENT + DECORATED_CLASS_EXPRESSION, DEFINE);
const unresolvedBase = projectWith(UNRESOLVED_ROOT, PAYMENT, DEFINE);

const leaks = (project: Project, inertEventMethods: readonly string[]) => {
  const target = project.getSourceFileOrThrow('/src/payment.ts').getClassOrThrow('Payment');
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
    expect(leaks(judgedDefine, [])).toEqual([]);
  });

  it('judges callers through this and super when the event method is listed', () => {
    expect(leaks(judgedDefine, ['addDomainEvent'])).toEqual(['pay', 'record', 'settle']);
  });

  it('judges callers the same way when class fields use assignment semantics', () => {
    expect(leaks(judgedAssign, ['addDomainEvent'])).toEqual(['pay', 'record', 'settle']);
  });

  it('judges the caller of a plain listed event method that nothing overrides', () => {
    expect(leaks(plain, ['addDomainEvent'])).toEqual(['pay']);
  });
});

describe('event methods that cannot be asserted inert', () => {
  it('ignores the entry when a project subclass redeclares the name as a field', () => {
    expect(leaks(fieldSubclassDefine, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry for a subclass field under assignment semantics', () => {
    expect(leaks(fieldSubclassAssign, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the method is reassigned on this', () => {
    expect(leaks(reassigned, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the method is reassigned through a bracket key', () => {
    expect(leaks(bracket, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the family assigns onto this', () => {
    expect(leaks(assigning, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a class in the family is decorated', () => {
    expect(leaks(decorated, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a class expression subclass redeclares the name as a field', () => {
    expect(leaks(classExpression, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a mixin applied to the aggregate declares the name as a field', () => {
    expect(leaks(mixin, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the method is replaced on the prototype', () => {
    expect(leaks(prototypeWrite, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when the name is an accessor', () => {
    expect(leaks(accessor, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a subclass field has a computed key naming it', () => {
    expect(leaks(computedKey, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a subclass field has a computed string key', () => {
    expect(leaks(openKey, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a class expression assigns onto this', () => {
    expect(leaks(assigningClassExpression, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a class expression is decorated', () => {
    expect(leaks(decoratedClassExpression, ['addDomainEvent'])).toEqual([]);
  });

  it('ignores the entry when a base class of the aggregate cannot be resolved', () => {
    expect(leaks(unresolvedBase, ['addDomainEvent'])).toEqual([]);
  });
});
