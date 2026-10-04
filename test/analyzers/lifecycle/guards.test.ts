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
  readsAfterAssignment(): void { this.props.status = Status.closed; this.props.title = String(this.props.status); }
  escapesAfterAssignment(): void { this.props.status = Status.closed; this.addEvent({ ticket: this }); }
  serialisesAfterAssignment(): void { this.props.status = Status.closed; this.props.title = JSON.stringify(this); }
  emitsAssignedStatus(): void { this.props.status = Status.closed; this.addEvent({ status: this.props.status }); }
  parenthesisedAssignment(): void { (this.props.status = Status.closed); this.addEvent({ status: this.props.status }); }
  guardedThenReadsAfterAssignment(): void { if (this.props.status === Status.closed) return; this.props.status = Status.open; this.props.title = this.props.status; }
  aliasBeforeAssignment(): void { const s = this.props.status; this.props.status = Status.open; if (s === Status.closed) throw new Error('closed'); }
  thisAliasBeforeAssignment(): void { const self = this; this.props.status = Status.open; if (self.props.title === 'x') return; }
  nestedAssignmentThenRead(flag: boolean): void { if (flag) { this.props.status = Status.open; } this.props.title = this.props.status; }
  assignmentReadsItself(): void { this.props.status = this.props.status === Status.draft ? Status.open : Status.closed; this.addEvent({}); }
  readsBeforeAssignment(): void { this.props.title = this.props.status; this.props.status = Status.open; }
  otherAssignmentDoesNotCut(): void { this.props.title = 'x'; this.props.title = this.props.status; }
  assertsAfterAssignment(): void { this.props.status = Status.closed; if (this.props.status !== Status.closed) throw new Error('x'); this.addEvent({}); }
  helperBeforeAssignment(): void { this.assertNotClosed(); this.props.status = Status.open; this.props.title = String(this.props.status); }
  archives(): void { this.archived = true; this.props.title = String(this.archived); }
  booleanGuard(): void { if (this.archived) return; this.props.title = 'x'; }
}
export class GuardedTicket extends AggregateRoot<{ status: Status; title: string }> {
  get status(): Status { return this.props.status; }
  set status(value: Status) { if (this.props.status === Status.closed) return; this.props.status = value; }
  assignsThroughSetter(): void { this.status = Status.open; if (this.props.status === Status.open) this.props.title = 'x'; }
  assignsProps(): void { this.props.status = Status.open; this.props.title = String(this.props.status); }
}
export class CopiedTicket {
  private _p: { status: Status; title: string } = { status: Status.draft, title: '' };
  get props(): { status: Status; title: string } { return { ...this._p }; }
  viaCopyGetter(): void { this.props.status = Status.closed; if (this.props.status === Status.open) { this._p = { ...this._p, title: 'x' }; } }
}
export class ClosableBase extends AggregateRoot<{ status: Status; title: string }> {
  protected get isClosed(): boolean { return this.props.status === Status.closed; }
}
export class ClosableTicket extends ClosableBase {
  rename(): void { if (this.isClosed) return; this.props.title = 'x'; }
}
`,
  '/src/shift.ts': `
import { AggregateRoot } from './aggregate-root';
export class Shift extends AggregateRoot<{ endedAt: Date | null | undefined; pausedAt: Date | null; archivedAt?: Date; cancelledAt?: Date | null; note: string }> {
  private get hasNoEnd(): boolean { return this.props.endedAt === null; }
  strictNullReturn(): void { if (this.props.endedAt === null) return; this.props.note = 'x'; }
  strictUndefinedThrow(): void { if (this.props.endedAt === undefined) throw new Error('x'); this.props.note = 'x'; }
  strictNotNullWrapper(): void { if (this.props.endedAt !== null) { this.props.note = 'x'; } }
  looseNullReturn(): void { if (this.props.endedAt == null) return; this.props.note = 'x'; }
  looseUndefinedReturn(): void { if (this.props.endedAt == undefined) return; this.props.note = 'x'; }
  looseNotNullWrapper(): void { if (this.props.endedAt != null) { this.props.note = 'x'; } }
  bothStrictCombined(): void { if (this.props.endedAt === null || this.props.endedAt === undefined) return; this.props.note = 'x'; }
  bothStrictSeparate(): void { if (this.props.endedAt === null) return; if (this.props.endedAt === undefined) return; this.props.note = 'x'; }
  bothStrictWrapper(): void { if (this.props.endedAt !== null && this.props.endedAt !== undefined) { this.props.note = 'x'; } }
  truthyReturn(): void { if (!this.props.endedAt) return; this.props.note = 'x'; }
  requiresEnded(): void { if (this.props.endedAt == null) { this.props.note = 'x'; } }
  requiresStrictNull(): void { if (this.props.endedAt === null) { this.props.note = 'x'; } }
  viaStrictGetter(): void { if (this.hasNoEnd) return; this.props.note = 'x'; }
  negatedStrict(): void { if (!(this.props.endedAt !== null)) return; this.props.note = 'x'; }
  strictWithUnrelated(flag: boolean): void { if (flag && this.props.endedAt === null) return; this.props.note = 'x'; }
  strictNotNullReturn(): void { if (this.props.endedAt !== null) return; this.props.note = 'x'; }
  strictThenAssigns(): void { if (this.props.endedAt === null) return; this.props.endedAt = new Date(); }
  unguarded(): void { this.props.note = 'x'; }
  cancelledStrictNullReturn(): void { if (this.props.cancelledAt === null) return; this.props.note = 'x'; }
  cancelledLooseNullReturn(): void { if (this.props.cancelledAt == null) return; this.props.note = 'x'; }
  pausedStrictNullReturn(): void { if (this.props.pausedAt === null) return; this.props.note = 'x'; }
  pausedStrictUndefinedReturn(): void { if (this.props.pausedAt === undefined) return; this.props.note = 'x'; }
  pausedStrictNotNullWrapper(): void { if (this.props.pausedAt !== null) { this.props.note = 'x'; } }
  archivedStrictUndefinedReturn(): void { if (this.props.archivedAt === undefined) return; this.props.note = 'x'; }
}
`,
  '/src/meter.ts': `
import { AggregateRoot } from './aggregate-root';
export class Meter extends AggregateRoot<{ reading: number | null; code: string | null | undefined; closedAt: Date | null; endedAt: Date | null | undefined; note: string }> {
  private get hasReading(): boolean { return !!this.props.reading; }
  private get hasClosed(): boolean { return !!this.props.closedAt; }
  private get currentReading(): number | null { return this.props.reading; }
  readingTruthyThrow(): void { if (this.props.reading) throw new Error('x'); this.props.note = 'x'; }
  readingFalsyReturn(): void { if (!this.props.reading) return; this.props.note = 'x'; }
  readingTruthyAndFlag(flag: boolean): void { if (flag && this.props.reading) return; this.props.note = 'x'; }
  readingTruthyOrNull(): void { if (this.props.reading || this.props.reading === null) return; this.props.note = 'x'; }
  readingWrapper(): void { if (this.props.reading) { this.props.note = 'x'; } }
  readingViaGetter(): void { if (this.hasReading) return; this.props.note = 'x'; }
  readingViaValueGetter(): void { if (!this.currentReading) return; this.props.note = 'x'; }
  readingStrictNullReturn(): void { if (this.props.reading === null) return; this.props.note = 'x'; }
  readingStrictNotNullWrapper(): void { if (this.props.reading !== null) { this.props.note = 'x'; } }
  codeTruthyThrow(): void { if (this.props.code) throw new Error('x'); this.props.note = 'x'; }
  codeFalsyReturn(): void { if (!this.props.code) return; this.props.note = 'x'; }
  codeLooseNullReturn(): void { if (this.props.code == null) return; this.props.note = 'x'; }
  closedTruthyThrow(): void { if (this.props.closedAt) throw new Error('x'); this.props.note = 'x'; }
  closedFalsyReturn(): void { if (!this.props.closedAt) return; this.props.note = 'x'; }
  closedTruthyAndFlag(flag: boolean): void { if (flag && this.props.closedAt) return; this.props.note = 'x'; }
  closedFalsyOrNote(): void { if (!this.props.closedAt || this.props.note === 'x') return; this.props.note = 'x'; }
  closedWrapper(): void { if (this.props.closedAt) { this.props.note = 'x'; } }
  closedViaGetter(): void { if (!this.hasClosed) return; this.props.note = 'x'; }
  endedTruthyThrow(): void { if (this.props.endedAt) throw new Error('x'); this.props.note = 'x'; }
  endedFalsyReturn(): void { if (!this.props.endedAt) return; this.props.note = 'x'; }
  endedWrapper(): void { if (this.props.endedAt) { this.props.note = 'x'; } }
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
    ['readsAfterAssignment', ['CLOSED', 'DRAFT', 'OPEN']],
    ['escapesAfterAssignment', ['CLOSED', 'DRAFT', 'OPEN']],
    ['serialisesAfterAssignment', ['CLOSED', 'DRAFT', 'OPEN']],
    ['emitsAssignedStatus', ['CLOSED', 'DRAFT', 'OPEN']],
    ['parenthesisedAssignment', ['CLOSED', 'DRAFT', 'OPEN']],
    ['guardedThenReadsAfterAssignment', ['DRAFT', 'OPEN']],
    ['aliasBeforeAssignment', 'unknown'],
    ['thisAliasBeforeAssignment', 'unknown'],
    ['nestedAssignmentThenRead', 'unknown'],
    ['assignmentReadsItself', 'unknown'],
    ['readsBeforeAssignment', 'unknown'],
    ['otherAssignmentDoesNotCut', 'unknown'],
    ['assertsAfterAssignment', ['CLOSED', 'DRAFT', 'OPEN']],
    ['helperBeforeAssignment', 'unknown'],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), status, defaultScope(ticket)))).toEqual(expected);
  });
});

describe('methodSources for a boolean field', () => {
  it.each([
    ['booleanGuard', ['false']],
    ['combined', ['false']],
    ['unguarded', ['false', 'true']],
    ['archives', ['false', 'true']],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(ticket.getMethodOrThrow(method), archived, defaultScope(ticket)))).toEqual(expected);
  });
});

describe('methodSources for a field with a guarding setter', () => {
  const guarded = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('GuardedTicket');
  const guardedStatus = resolvedField(guarded, 'status');

  it.each([
    ['assignsThroughSetter', 'unknown'],
    ['assignsProps', ['CLOSED', 'DRAFT', 'OPEN']],
  ])('%s can run from %j', (method, expected) => {
    expect(describeSources(methodSources(guarded.getMethodOrThrow(method), guardedStatus, defaultScope(guarded)))).toEqual(expected);
  });
});

describe('methodSources for a state holder returned by a getter', () => {
  it('does not treat an assignment to a returned copy as overwriting the field', () => {
    const copied = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('CopiedTicket');
    const copiedStatus = resolvedField(copied, 'status');
    expect(describeSources(methodSources(copied.getMethodOrThrow('viaCopyGetter'), copiedStatus, defaultScope(copied)))).toEqual('unknown');
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

describe('methodSources for a nullable field', () => {
  const shift = project.getSourceFileOrThrow('/src/shift.ts').getClassOrThrow('Shift');
  const sourcesOf = (method: string, field: string) =>
    describeSources(methodSources(shift.getMethodOrThrow(method), resolvedField(shift, field), defaultScope(shift)));

  it.each([
    ['strictNullReturn', 'unknown'],
    ['strictUndefinedThrow', 'unknown'],
    ['strictNotNullWrapper', 'unknown'],
    ['looseNullReturn', ['set']],
    ['looseUndefinedReturn', ['set']],
    ['looseNotNullWrapper', ['set']],
    ['bothStrictCombined', ['set']],
    ['bothStrictSeparate', ['set']],
    ['bothStrictWrapper', ['set']],
    ['truthyReturn', ['set']],
    ['requiresEnded', ['unset']],
    ['requiresStrictNull', 'unknown'],
    ['viaStrictGetter', 'unknown'],
    ['negatedStrict', 'unknown'],
    ['strictWithUnrelated', ['set', 'unset']],
    ['strictNotNullReturn', 'unknown'],
    ['strictThenAssigns', 'unknown'],
    ['unguarded', ['set', 'unset']],
  ])('%s can run from %j when the type includes null and undefined', (method, expected) => {
    expect(sourcesOf(method, 'endedAt')).toEqual(expected);
  });

  it.each([
    ['pausedStrictNullReturn', ['set']],
    ['pausedStrictUndefinedReturn', ['set']],
    ['pausedStrictNotNullWrapper', ['set']],
    ['unguarded', ['set', 'unset']],
  ])('%s can run from %j when the type includes only null', (method, expected) => {
    expect(sourcesOf(method, 'pausedAt')).toEqual(expected);
  });

  it.each([
    ['cancelledStrictNullReturn', 'unknown'],
    ['cancelledLooseNullReturn', ['set']],
  ])('%s can run from %j when an optional field also includes null', (method, expected) => {
    expect(sourcesOf(method, 'cancelledAt')).toEqual(expected);
  });

  it('treats a strict undefined check as covering an optional field', () => {
    expect(sourcesOf('archivedStrictUndefinedReturn', 'archivedAt')).toEqual(['set']);
  });
});

describe('methodSources for a nullable field whose set values may be falsy', () => {
  const meter = project.getSourceFileOrThrow('/src/meter.ts').getClassOrThrow('Meter');
  const sourcesOf = (method: string, field: string) =>
    describeSources(methodSources(meter.getMethodOrThrow(method), resolvedField(meter, field), defaultScope(meter)));

  it.each([
    ['readingTruthyThrow', 'unknown'],
    ['readingFalsyReturn', 'unknown'],
    ['readingTruthyAndFlag', 'unknown'],
    ['readingTruthyOrNull', 'unknown'],
    ['readingWrapper', 'unknown'],
    ['readingViaGetter', 'unknown'],
    ['readingViaValueGetter', 'unknown'],
    ['readingStrictNullReturn', ['set']],
    ['readingStrictNotNullWrapper', ['set']],
  ])('%s can run from %j when a number field may hold zero', (method, expected) => {
    expect(sourcesOf(method, 'reading')).toEqual(expected);
  });

  it.each([
    ['codeTruthyThrow', 'unknown'],
    ['codeFalsyReturn', 'unknown'],
    ['codeLooseNullReturn', ['set']],
  ])('%s can run from %j when a string field may hold an empty string', (method, expected) => {
    expect(sourcesOf(method, 'code')).toEqual(expected);
  });

  it.each([
    ['closedTruthyThrow', ['unset']],
    ['closedFalsyReturn', ['set']],
    ['closedTruthyAndFlag', ['set', 'unset']],
    ['closedFalsyOrNote', ['set']],
    ['closedWrapper', ['set']],
    ['closedViaGetter', ['set']],
  ])('%s can run from %j when a date field cannot be falsy', (method, expected) => {
    expect(sourcesOf(method, 'closedAt')).toEqual(expected);
  });

  it.each([
    ['endedTruthyThrow', ['unset']],
    ['endedFalsyReturn', ['set']],
    ['endedWrapper', ['set']],
  ])('%s can run from %j when a date field includes null and undefined', (method, expected) => {
    expect(sourcesOf(method, 'endedAt')).toEqual(expected);
  });
});
