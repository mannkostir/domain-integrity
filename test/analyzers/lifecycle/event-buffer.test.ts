import { Node } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { eventBuffers } from '../../../src/analyzers/lifecycle/event-buffer';
import { projectIndex } from '../../../src/analyzers/lifecycle/project-index';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/buffers.ts': `
class Opened { constructor(readonly id: string) {} }
const sealed = (target: unknown, context: unknown): void => { void target; void context; };
export class Outbox {
  private readonly _events: object[] = [];
  get domainEvents(): ReadonlyArray<object> { return [...this._events]; }
  clearEvents(): void { this._events.length = 0; }
  open(): void { this._events.push(new Opened('a')); }
}
export class Drained {
  private events: object[] = [];
  addEvent(event: object): void { this.events.push(event); }
  pull(): object[] { const taken = this.events; this.events = []; return taken; }
  flush(): object[] { return this.events.splice(0); }
  get all(): object[] { return this.events; }
}
export class Assigned {
  private readonly _events: object[] = [];
  constructor(props: { id: string }) { Object.assign(this, props); }
  open(): void { this._events.push(new Opened('a')); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedCarrying {
  private readonly _events: object[] = [];
  constructor(props: { id: string; _events: object[] }) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedAny {
  private readonly _events: object[] = [];
  constructor(props: any) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedGeneric<P extends object> {
  private readonly _events: object[] = [];
  constructor(props: P) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedIntersection<P extends object> {
  private readonly _events: object[] = [];
  constructor(props: P & { id: string }) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedPartial<P extends object> {
  private readonly _events: object[] = [];
  constructor(props: Partial<P>) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedReadonly<P extends object> {
  private readonly _events: object[] = [];
  constructor(props: Readonly<P>) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
interface Essentials { id: string }
interface Optionals { balance?: number }
export class AssignedRequiredIntersection {
  private readonly _events: object[] = [];
  constructor(props: Essentials & Required<Optionals>) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedConcretePartial {
  private readonly _events: object[] = [];
  constructor(props: Partial<{ id: string }>) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedConcreteCarrying {
  private readonly _events: object[] = [];
  constructor(props: Required<{ id: string; _events?: object[] }>) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
class CartItem { constructor(readonly sku: string, readonly qty: number) {} }
export class Cart {
  private checkedOut = false;
  private _items: CartItem[] = [];
  add(sku: string, qty: number): void { if (this.checkedOut) throw new Error('x'); this._items.push(new CartItem(sku, qty)); }
  get items(): CartItem[] { return this._items; }
  get total(): number { return this.items.reduce((sum, item) => sum + item.qty, 0); }
  checkout(): void { if (this.checkedOut) throw new Error('x'); this.checkedOut = true; }
  clear(): void { this._items = []; }
}
export class PulledAndCounted {
  private events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
  pull(): object[] { const taken = this.events; this.events = []; return taken; }
  count(): number { return this.pull().length; }
}
export class NestedReturn {
  private events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
  reader(): () => object[] { return () => { return this.events; }; }
}
export class AssignedObject {
  private readonly _events: object[] = [];
  constructor(props: object) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class AssignedEmpty {
  private readonly _events: object[] = [];
  constructor(props: {}) { Object.assign(this, props); }
  clearEvents(): void { this._events.length = 0; }
}
export class NonArray {
  private note = '';
  wipe(): void { this.note.length = 0; }
}
export class Iterated {
  private items: object[] = [];
  open(): void { this.items.push(new Opened('a')); }
  count(): number { let n = 0; for (const item of this.items) { void item; n++; } return n; }
  clear(): void { this.items = []; }
}
export class Indexed {
  private items: object[] = [];
  open(): void { this.items.push(new Opened('a')); }
  first(): object | undefined { return this.items[0]; }
}
export class LengthRead {
  private items: object[] = [];
  open(): void { this.items.push(new Opened('a')); }
  size(): number { return this.items.length; }
}
export class ParameterPush {
  private items: object[] = [];
  add(item: object): void { this.items.push(item); }
  clear(): void { this.items = []; }
}
export class PartialSplice {
  private events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
  dropFirst(): void { this.events.splice(1); }
}
export class SpliceIterated {
  private events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
  each(): void { this.events.splice(0).forEach((event) => void event); }
}
export class Protected {
  protected events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
}
@sealed
export class Decorated {
  private events: object[] = [];
  open(): void { this.events.push(new Opened('a')); }
}
export class ComputedWrite {
  private events: object[] = [];
  set(key: string, value: unknown): void { (this as Record<string, unknown>)[key] = value; }
  open(): void { this.events.push(new Opened('a')); }
}
`,
});

const buffersOf = (name: string): string[] => {
  const cls = project.getSourceFileOrThrow('/src/buffers.ts').getClassOrThrow(name);
  return [...eventBuffers([cls], projectIndex(project.getSourceFiles()).bracketWrites, [], new Set(['addEvent']))]
    .filter(Node.isPropertyDeclaration)
    .map((property) => property.getName());
};

describe('eventBuffers', () => {
  it('proves an array pushed with new events, reset by length and copied out', () => {
    expect(buffersOf('Outbox')).toEqual(['_events']);
  });

  it('proves an array pushed by a push-only event method and drained in every handed-out form', () => {
    expect(buffersOf('Drained')).toEqual(['events']);
  });

  it('proves an array when Object.assign onto this cannot carry its name', () => {
    expect(buffersOf('Assigned')).toEqual(['_events']);
  });

  it('rejects an array when Object.assign onto this can carry its name', () => {
    expect(buffersOf('AssignedCarrying')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes an any source', () => {
    expect(buffersOf('AssignedAny')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes a type-parameter source', () => {
    expect(buffersOf('AssignedGeneric')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes an intersection with a type parameter', () => {
    expect(buffersOf('AssignedIntersection')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes a Partial of a type parameter', () => {
    expect(buffersOf('AssignedPartial')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes a Readonly of a type parameter', () => {
    expect(buffersOf('AssignedReadonly')).toEqual([]);
  });

  it('proves an array when Object.assign onto this takes an intersection with a concrete Required', () => {
    expect(buffersOf('AssignedRequiredIntersection')).toEqual(['_events']);
  });

  it('proves an array when Object.assign onto this takes a concrete Partial without its name', () => {
    expect(buffersOf('AssignedConcretePartial')).toEqual(['_events']);
  });

  it('rejects an array when Object.assign onto this takes a concrete Required carrying its name', () => {
    expect(buffersOf('AssignedConcreteCarrying')).toEqual([]);
  });

  it('rejects an array the aggregate iterates', () => {
    expect(buffersOf('Iterated')).toEqual([]);
  });

  it('rejects an array the aggregate indexes', () => {
    expect(buffersOf('Indexed')).toEqual([]);
  });

  it('rejects an array whose length the aggregate reads', () => {
    expect(buffersOf('LengthRead')).toEqual([]);
  });

  it('rejects an array pushed with a parameter outside an event method', () => {
    expect(buffersOf('ParameterPush')).toEqual([]);
  });

  it('rejects an array spliced from a non-zero index', () => {
    expect(buffersOf('PartialSplice')).toEqual([]);
  });

  it('rejects an array whose spliced contents the aggregate iterates', () => {
    expect(buffersOf('SpliceIterated')).toEqual([]);
  });

  it('rejects a protected array', () => {
    expect(buffersOf('Protected')).toEqual([]);
  });

  it('rejects an array in a class with an unknown class decorator', () => {
    expect(buffersOf('Decorated')).toEqual([]);
  });

  it('rejects an array in a class that writes computed keys on this', () => {
    expect(buffersOf('ComputedWrite')).toEqual([]);
  });

  it('rejects an array whose getter the aggregate reads through its own member', () => {
    expect(buffersOf('Cart')).toEqual([]);
  });

  it('rejects an array whose drained const is returned by a method another method calls', () => {
    expect(buffersOf('PulledAndCounted')).toEqual([]);
  });

  it('rejects an array returned only from inside a nested function', () => {
    expect(buffersOf('NestedReturn')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes an object source', () => {
    expect(buffersOf('AssignedObject')).toEqual([]);
  });

  it('rejects an array when Object.assign onto this takes an empty literal source', () => {
    expect(buffersOf('AssignedEmpty')).toEqual([]);
  });

  it('never proves a field that is not an array', () => {
    expect(buffersOf('NonArray')).toEqual([]);
  });
});
