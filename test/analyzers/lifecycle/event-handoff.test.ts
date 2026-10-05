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
  private record(event: object): void { void event; }
}
export class Ledger extends AggregateRoot {
  protected props: { status: Status; note: string } = { status: 'open', note: '' };
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
  touch(n: string): void { this.props.note = n; this.apply(new Opened(this)); }
  share(n: string): void { this.props.note = n; this.apply(new Opened(this.props)); }
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

describe('this handed to a transparent event constructor', () => {
  it('is judged when the event goes straight to a library event method', () => {
    expect(leaks(classNamed('Ticket'))).toEqual(['audit', 'touch']);
  });

  it('is judged on an aggregate whose state lives in props', () => {
    expect(leaks(classNamed('Ledger'))).toEqual(['touch']);
  });

  it('stays unknown when the event method is not configured', () => {
    expect(leaks(classNamed('Ticket'), [])).toEqual([]);
  });

  it('stays unknown when the event method is declared in the project', () => {
    expect(leaks(classNamed('ProjectTicket'))).toEqual([]);
  });
});
