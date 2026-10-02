import { describe, expect, it } from 'vitest';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/src/ticket.ts': `
import { AggregateRoot } from './aggregate-root';
export enum Status { draft = 'DRAFT', open = 'OPEN', closed = 'CLOSED' }
class Policy {
  static editable(ticket: object): boolean { return ticket !== undefined; }
}
class Rules {
  static notClosed(value: Status): boolean { return value !== Status.closed; }
}
function throwClosed(): never { throw new Error('closed'); }
export class Ticket extends AggregateRoot<{ status: Status; title: string; lines: string[] }> {
  private archived = false;
  private get isOpen(): boolean { return this.props.status === Status.open; }
  private get isEditable(): boolean { return this.isOpen || this.props.status === Status.draft; }
  private isClosed(): boolean { return this.props.status === Status.closed; }
  private assertNotClosed(): void { if (this.props.status === Status.closed) throw new Error('closed'); }
  private get isClosedBlock(): boolean { const s = this.props.status; return s === Status.closed; }
  localAlias(): void { const s = this.props.status; if (s === Status.closed) return; this.props.title = 'x'; }
  destructured(): void { const { status } = this.props; if (status === Status.closed) return; this.props.title = 'x'; }
  viaMethod(): void { if (this.isClosed()) return; this.props.title = 'x'; }
  viaAssertion(): void { this.assertNotClosed(); this.props.title = 'x'; }
  viaBlockGetter(): void { if (this.isClosedBlock) return; this.props.title = 'x'; }
  viaPolicy(): void { if (!Policy.editable(this)) return; this.props.title = 'x'; }
  returnsAfterWork(): void { if (this.props.status !== Status.closed) { this.props.title = 'x'; return; } }
  transitionsThenReturns(): void { if (this.props.status === Status.draft) { this.props.status = Status.open; return; } }
  shortCircuit(): void { this.props.status !== Status.closed || throwClosed(); this.props.title = 'x'; }
  loopCondition(): void { for (; this.props.status !== Status.closed; ) { this.props.title = 'x'; break; } }
  switchTrue(): void { switch (true) { case this.props.status === Status.closed: return; } this.props.title = 'x'; }
  elementAccess(): void { if (this.props['status'] === Status.closed) return; this.props.title = 'x'; }
  aliasProps(): void { const p = this.props; if (p.status === Status.closed) return; this.props.title = 'x'; }
  destructuredProps(): void { const { props } = this; if (props.status === Status.closed) return; this.props.title = 'x'; }
  nestedDestructure(): void { const { props: { status } } = this; if (status === Status.closed) return; this.props.title = 'x'; }
  aliasThis(): void { const self = this; if (self.props.status === Status.closed) return; this.props.title = 'x'; }
  spreadCopy(): void { const p = { ...this.props }; if (p.status === Status.closed) return; this.props.title = 'x'; }
  viaArrowPredicate(): void { if (this.isClosedArrow()) return; this.props.title = 'x'; }
  nonNullReceiver(): void { if (this.props!.status === Status.closed) return; this.props.title = 'x'; }
  asReceiver(): void { if ((this.props as { status: Status }).status === Status.closed) return; this.props.title = 'x'; }
  parenthesisedReceiver(): void { if ((this.props).status === Status.closed) return; this.props.title = 'x'; }
  elementProps(): void { if (this['props'].status === Status.closed) return; this.props.title = 'x'; }
  deepChain(): void { if (this.hop1()) return; this.props.title = 'x'; }
  private isClosedArrow = () => this.props.status === Status.closed;
  private hop1(): boolean { return this.hop2(); }
  private hop2(): boolean { return this.hop3(); }
  private hop3(): boolean { return this.hop4(); }
  private hop4(): boolean { return this.hop5(); }
  private hop5(): boolean { return this.hop6(); }
  private hop6(): boolean { return this.props.status === Status.closed; }
  destructuredArrow(): void { const { isClosedArrow } = this; if (isClosedArrow()) return; this.props.title = 'x'; }
  destructuredGetter(): void { const { isOpen } = this; if (!isOpen) return; this.props.title = 'x'; }
  computedKey(): void { const k = 'status' as const; const { [k]: s } = this.props; if (s === Status.closed) return; this.props.title = 'x'; }
  reassignedAlias(): void { let p; p = this.props; if (p.status === Status.closed) return; this.props.title = 'x'; }
  nullishAlias(): void { const p = this.props ?? undefined; if (p.status === Status.closed) return; this.props.title = 'x'; }
  arrayAlias(): void { const [p] = [this.props]; if (p.status === Status.closed) return; this.props.title = 'x'; }
  destructuredTitle(): void { const { title } = this.props; if (this.props.status === Status.closed) return; this.props.title = title + 'x'; }
  conditionalAlias(flag: boolean): void { const p = flag ? this.props : this.props; if (p.status === Status.closed) return; this.props.title = 'x'; }
  pushesLine(): void { this.props.lines.push('x'); }
  emitsEvent(): void { this.addEvent({}); }
  unguarded(): void { this.props.title = 'x'; }
  earlyReturn(): void { if (this.props.status !== Status.open) return; this.props.title = 'x'; }
  earlyThrow(): void { if (this.props.status === Status.closed) throw new Error('closed'); this.props.title = 'x'; }
  viaGetter(): void { if (!this.isOpen) return; this.props.title = 'x'; }
  viaNestedGetter(): void { if (!this.isEditable) return; this.props.title = 'x'; }
  wrapped(): void { if (this.props.status === Status.draft) { this.props.title = 'x'; } }
  combined(): void { if (this.props.status === Status.closed || this.archived) return; this.props.title = 'x'; }
  throwHelper(): void { if (this.props.status === Status.closed) throwClosed(); this.props.title = 'x'; }
  ruleObject(): void { if (!Rules.notClosed(this.props.status)) return; this.props.title = 'x'; }
  branching(): void { const next = this.props.status === Status.open ? 'a' : 'b'; this.props.title = next; }
  booleanGuard(): void { if (this.archived) return; this.props.title = 'x'; }
}
export class ClosableBase extends AggregateRoot<{ status: Status; title: string }> {
  protected get isClosed(): boolean { return this.props.status === Status.closed; }
}
export class ClosableTicket extends ClosableBase {
  rename(): void { if (this.isClosed) return; this.props.title = 'x'; }
}
`,
});

const ticket = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');
const status = resolvedField(ticket, 'status');
const archived = resolvedField(ticket, 'archived');

describe('methodSources for an enum field', () => {
  it.each([
    ['unguarded', ['CLOSED', 'DRAFT', 'OPEN']],
    ['earlyReturn', ['OPEN']],
    ['earlyThrow', ['DRAFT', 'OPEN']],
    ['viaGetter', ['OPEN']],
    ['viaNestedGetter', ['DRAFT', 'OPEN']],
    ['wrapped', ['DRAFT']],
    ['combined', ['DRAFT', 'OPEN']],
    ['throwHelper', ['DRAFT', 'OPEN']],
    ['ruleObject', 'unknown'],
    ['branching', 'unknown'],
    ['localAlias', 'unknown'],
    ['destructured', 'unknown'],
    ['viaMethod', 'unknown'],
    ['viaAssertion', 'unknown'],
    ['viaBlockGetter', 'unknown'],
    ['viaPolicy', 'unknown'],
    ['returnsAfterWork', 'unknown'],
    ['transitionsThenReturns', 'unknown'],
    ['shortCircuit', 'unknown'],
    ['loopCondition', 'unknown'],
    ['switchTrue', 'unknown'],
    ['elementAccess', ['DRAFT', 'OPEN']],
    ['destructuredArrow', 'unknown'],
    ['destructuredGetter', 'unknown'],
    ['computedKey', 'unknown'],
    ['reassignedAlias', 'unknown'],
    ['nullishAlias', 'unknown'],
    ['arrayAlias', 'unknown'],
    ['destructuredTitle', 'unknown'],
    ['conditionalAlias', 'unknown'],
    ['pushesLine', ['CLOSED', 'DRAFT', 'OPEN']],
    ['emitsEvent', 'unknown'],
    ['aliasProps', 'unknown'],
    ['destructuredProps', 'unknown'],
    ['nestedDestructure', 'unknown'],
    ['aliasThis', 'unknown'],
    ['spreadCopy', 'unknown'],
    ['viaArrowPredicate', 'unknown'],
    ['nonNullReceiver', ['DRAFT', 'OPEN']],
    ['asReceiver', ['DRAFT', 'OPEN']],
    ['parenthesisedReceiver', ['DRAFT', 'OPEN']],
    ['elementProps', ['DRAFT', 'OPEN']],
    ['deepChain', 'unknown'],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), status, defaultScope(ticket)))).toEqual(expected);
  });
});

describe('methodSources for a boolean field', () => {
  it.each([
    ['booleanGuard', ['false']],
    ['combined', ['false']],
    ['unguarded', ['false', 'true']],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), archived, defaultScope(ticket)))).toEqual(expected);
  });
});

describe('methodSources with an inherited getter', () => {
  it('evaluates a single-return getter declared on a base class', () => {
    const closable = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('ClosableTicket');
    const closableStatus = resolvedField(closable, 'status');
    expect(describeSources(methodSources(closable.getMethodOrThrow('rename'), closableStatus, defaultScope(closable)))).toEqual([
      'DRAFT',
      'OPEN',
    ]);
  });
});
