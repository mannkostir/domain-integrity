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
});
