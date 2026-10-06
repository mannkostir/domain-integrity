import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/cqrs.d.ts': `
export declare class AggregateRoot { apply(event: object): void; addDomainEvent(event: object): void; }
`,
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/ticket.ts': `
import { AggregateRoot } from '../types/cqrs';
import { AggregateRoot as ProjectRoot } from './aggregate-root';
export type Status = 'open' | 'closed';
export class Opened { constructor(readonly source: object) {} }
type Ctor = new (...args: never[]) => object;
export function Guarded<T extends Ctor>(Base: T): T {
  return class extends Base {
    constructor(...args: never[]) {
      super(...args);
      if ((args[0] as unknown as { status: Status }).status === 'closed') throw new Error('closed');
    }
  };
}
export class GuardedOpened extends Guarded(Opened) {}
export class Audited {
  readonly source: object;
  readonly at: Date;
  constructor(source: object) { this.at = new Date(); this.source = source; }
}
export class Peeking { readonly label: string; constructor(source: Ticket) { this.label = source.label(); } }
export class Ticket extends AggregateRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  label(): string { return this.note; }
  touch(n: string): void { this.note = n; this.apply(new Opened(this)); }
  audit(n: string): void { this.note = n; this.addDomainEvent(new Audited(this)); }
  guardedTouch(n: string): void { if (this.status === 'closed') return; this.note = n; this.apply(new Opened(this)); }
  peek(n: string): void { this.note = n; this.apply(new Peeking(this)); }
  held(n: string): void { this.note = n; const event = new Opened(this); this.apply(event); }
  handedElsewhere(n: string): void { this.note = n; this.record(new Opened(this)); }
  computedKey(n: string): void { this.note = n; this['apply'](new Opened(this)); }
  conditional(n: string, flag: boolean): void { this.note = n; this.apply(flag ? new Opened(this) : {}); }
  private record(event: object): void { void event; }
}
export class Ledger extends AggregateRoot {
  protected props: { status: Status; note: string } = { status: 'open', note: '' };
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
  touch(n: string): void { this.props.note = n; this.apply(new Opened(this)); }
  share(n: string): void { this.props.note = n; this.apply(new Opened(this.props)); }
}
export class GuardedTicket extends AggregateRoot {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.note = n; this.apply(new GuardedOpened(this)); }
}
export class MixinBase {}
export const Applying = <T extends Ctor>(Base: T) =>
  class extends Base {
    apply(event: { source: { isClosed(): boolean } }): void { if (event.source.isClosed()) throw new Error('closed'); }
  };
export class MixinTicket extends Applying(MixinBase) {
  private status: Status = 'open';
  private note = '';
  isClosed(): boolean { return this.status === 'closed'; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.note = n; this.apply(new Opened(this)); }
}
export function AnnotatedApplying<T extends Ctor>(Base: T): T {
  return class extends Base {
    apply(event: { source: { isClosed(): boolean } }): void { if (event.source.isClosed()) throw new Error('closed'); }
  };
}
export class AnnotatedMixinTicket extends AnnotatedApplying(AggregateRoot) {
  private status: Status = 'open';
  private note = '';
  isClosed(): boolean { return this.status === 'closed'; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.apply(new Opened(this)); this.note = n; }
}
export class Intermediate extends AggregateRoot {}
export class LayeredTicket extends Intermediate {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.note = n; this.apply(new Opened(this)); }
}
export class OverridingTicket extends AggregateRoot {
  private status: Status = 'open';
  private note = '';
  override apply(event: object): void { super.apply(event); }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.note = n; super.apply(new Opened(this)); }
}
export class ProjectTicket extends ProjectRoot<object> {
  private status: Status = 'open';
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  touch(n: string): void { this.note = n; this.addEvent(new Opened(this)); }
}
`,
});

const classNamed = (name: string): ClassDeclaration => project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow(name);

const leaks = (target: ClassDeclaration, eventMethods: readonly string[] = DEFAULT_DECLARATION.eventMethods) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      eventMethods,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: project.getSourceFiles(),
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method)
    .sort();
};

describe('this handed to a transparent event constructor', () => {
  it('is judged when the event goes straight to a library event method', () => {
    expect(leaks(classNamed('Ticket'))).toEqual(['audit', 'touch']);
  });

  it('is judged on an aggregate whose state lives in props', () => {
    expect(leaks(classNamed('Ledger'))).toEqual(['touch']);
  });

  it('stays unknown when the event class extends a mixin', () => {
    expect(leaks(classNamed('GuardedTicket'))).toEqual([]);
  });

  it('stays unknown when the aggregate overrides the library event method it calls through super', () => {
    expect(leaks(classNamed('OverridingTicket'))).toEqual([]);
  });

  it('stays unknown when the event method comes from a project mixin', () => {
    expect(leaks(classNamed('MixinTicket'))).toEqual([]);
  });

  it('is judged on an aggregate whose project base extends the library root by name', () => {
    expect(leaks(classNamed('LayeredTicket'))).toEqual(['touch']);
  });

  it('stays unknown when an annotated mixin hides a project event method', () => {
    expect(leaks(classNamed('AnnotatedMixinTicket'))).toEqual([]);
  });

  it('stays unknown when the event method is not configured', () => {
    expect(leaks(classNamed('Ticket'), [])).toEqual([]);
  });

  it('is judged when a project event method only pushes onto a private array', () => {
    expect(leaks(classNamed('ProjectTicket'))).toEqual(['touch']);
  });
});
