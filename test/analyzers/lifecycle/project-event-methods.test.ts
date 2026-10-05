import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/root.ts': `
export abstract class Root {
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); }
}
export abstract class ReplacingRoot {
  private events: object[] = [];
  protected addDomainEvent(event: object): void { this.events.push(event); }
  protected replace(next: object[]): void { this.events = next; }
}
export abstract class CheckingRoot {
  private events: object[] = [];
  protected addDomainEvent(event: object): void { if (this.events.includes(event)) return; this.events.push(event); }
}
`,
  '/src/order.ts': `
import { CheckingRoot, ReplacingRoot, Root } from './root';
export type Status = 'open' | 'closed';
export class Noted { constructor(readonly note: string) {} }
export class Order extends Root {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Noted(n)); }
  register(registry: { add(order: Order): void }): void { registry.add(this); }
}
export class ReplacingOrder extends ReplacingRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Noted(n)); }
  register(registry: { add(order: ReplacingOrder): void }): void { registry.add(this); }
}
export class CheckingOrder extends CheckingRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  pay(n: string): void { this.note = n; this.addDomainEvent(new Noted(n)); }
  register(registry: { add(order: CheckingOrder): void }): void { registry.add(this); }
}
`,
});

const classNamed = (name: string): ClassDeclaration => project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow(name);

const leaks = (target: ClassDeclaration, eventMethods: readonly string[] = DEFAULT_DECLARATION.eventMethods) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      eventMethods,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined }], allowAfterTerminal: [] }],
    },
    files: project.getSourceFiles(),
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method)
    .sort();
};

describe('push onto a plain event array in an aggregate that leaks this', () => {
  it('judges a method whose event method only pushes onto a plain field', () => {
    expect(leaks(classNamed('Order'))).toEqual(['pay']);
  });

  it('leaves a method unjudged when the field is reassigned from another value', () => {
    expect(leaks(classNamed('ReplacingOrder'))).toEqual([]);
  });

  it('leaves a method unjudged when the event method also reads the field', () => {
    expect(leaks(classNamed('CheckingOrder'))).toEqual([]);
  });
});
