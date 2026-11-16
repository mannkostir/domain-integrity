import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { unreachableState } from '../../../src/analyzers/lifecycle/checks/unreachable-state';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeAssigned, describeSources } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const wrapper = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
abstract class RecordBase<T> {
  protected readonly props: T;
  constructor(props: T) { this.props = props; }
  equals(other?: RecordBase<T>): boolean { return JSON.stringify(this.props) === JSON.stringify(other?.props); }
}
export class Status extends RecordBase<Props> {
  constructor(value: Stage) { super({ value }); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  static fromPersistence(value: string): Status { return new Status(value as Stage); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
`;
const aggregate = `
import { AggregateRoot } from './root';
import { Status, Stage } from './status';
export class Ticket extends AggregateRoot<{ status: Status; title: string }> {
  constructor(props: { status: Status; title: string }) { super(props); }
  static create(): Ticket { return new Ticket({ status: Status.create(Stage.open), title: '' }); }
  get status(): Status { return this.props.status; }
  close(): void { if (this.props.status.isClosed()) return; this.props.status = Status.create(Stage.closed); }
  rename(): void { this.props.title = 'x'; }
  scalar(): void { if (this.props.status.value === Stage.closed) return; this.props.title = 'x'; }
  payload(): void { if (this.props.status.isClosed()) throw new Error(this.props.status.value); this.props.title = 'x'; }
  snapshot(): void { const s = this.props.status.value; this.props.status = Status.create(Stage.closed); }
  identity(): void { if ((this.props.status as unknown) !== Stage.open) return; this.props.title = 'x'; }
}
`;
const setup = (extra = '', text = aggregate, status = wrapper, declared = true) => {
  const project = inMemoryProject({ '/root.ts': AGGREGATE_ROOT, '/status.ts': status, '/ticket.ts': text, '/extra.ts': extra });
  const cls = project.getSourceFileOrThrow('/ticket.ts').getClassOrThrow('Ticket');
  const model = extractLifecycles({
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
    declaration: { ...DEFAULT_DECLARATION, lifecycles: declared ? [{ target: cls, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] : [] },
  });
  const ticket = model.aggregates.find(item => item.name === 'Ticket')!;
  return { model, ticket, facts: (name: string) => ticket.methods.find(method => method.name === name)!.fields.get('status')! };
};

describe('projected lifecycle integration', () => {
  it('accepts primitive enum terminals for a structurally proven wrapper', () => {
    expect(setup().model.problems).toEqual([]);
  });
  it('discovers the projected finite enum without a declaration', () => {
    expect(setup('', aggregate, wrapper, false).ticket.fields.find(field => field.name === 'status')?.values.map(value => value.token)).toEqual(['OPEN', 'CLOSED']);
  });
  it('uses wrapper predicate partitions for entry guards', () => {
    expect(describeSources(setup().facts('close').sources)).toEqual(['OPEN']);
  });
  it('maps a whole-wrapper factory replacement to its scalar token', () => {
    expect(describeAssigned(setup().facts('close').sets)).toEqual({ tokens: ['CLOSED'], unresolved: false, mayWrite: false });
  });
  it('recognizes exact scalar getter comparisons', () => {
    expect(describeSources(setup().facts('scalar').sources)).toEqual(['OPEN']);
  });
  it('allows scalar getter reads in rejected exit payloads', () => {
    expect(describeSources(setup().facts('payload').sources)).toEqual(['OPEN']);
  });
  it('keeps pre-write scalar snapshots unknown', () => {
    expect(describeSources(setup().facts('snapshot').sources)).toBe('unknown');
  });
  it('does not turn a whole-wrapper cast comparison into a scalar guard', () => {
    expect(describeSources(setup().facts('identity').sources)).toBe('unknown');
  });
  it('retains a justified unguarded terminal leak positive', () => {
    expect(terminalStateLeak(setup().ticket).map(finding => finding.details.method)).toEqual(['rename']);
  });
  it('merges known construction with unresolved caller props evidence', () => {
    expect(describeAssigned(setup().ticket.initial.get('status')!)).toEqual({ tokens: ['OPEN'], unresolved: true, mayWrite: false });
  });
});

const unsafeUses = [
  'import { Status } from "./status"; Status.prototype.isClosed = () => false;',
  'import { Status } from "./status"; Status.create = value => new Status(value);',
  'import { Status } from "./status"; Object.defineProperty(Status.prototype, "value", { get: () => "OPEN" });',
  'import { Status } from "./status"; class Child extends Status {}',
  'import { Status } from "./status"; function use(s: Status) { const alias = s; }',
  'import { Status } from "./status"; declare function opaque(s: Status): void; function use(s: Status) { opaque(s); }',
  'import { Status } from "./status"; function use(s: Status) { (s as any).props.value = "OPEN"; }',
  'import { Status } from "./status"; function use(s: Status) { (s as any).isClosed = () => false; }',
  'import { Status } from "./status"; declare const key: string; function use(s: Status) { (s as any)[key] = false; }',
];
describe('observable projection invalidation', () => {
  it.each(unsafeUses)('withholds false terminal findings for %s', extra => {
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
  it.each(unsafeUses)('retains the finite field while withholding reachability for %s', extra => {
    const { ticket } = setup(extra);
    expect({ fields: ticket.fields.map(field => field.name), unreachable: unreachableState(ticket) }).toEqual({ fields: ['status'], unreachable: [] });
  });
  it('does not contaminate the wrapper with an unrelated same-name declaration', () => {
    const { ticket } = setup('class Status { value = "OPEN"; } Status.prototype.value = "CLOSED";');
    expect(terminalStateLeak(ticket).map(finding => finding.details.method)).toEqual(['rename']);
  });
});

describe('projection exposure boundaries', () => {
  it.each([
    'const p = this.props; p.status = Status.create(Stage.open);',
    'const { status } = this.props; status.isClosed = () => false;',
    'const p = this.props; Object.defineProperty(p.status, "value", { get: () => Stage.open });',
    'const s = this.props.status; s.isClosed = () => false;',
    'const s = [this.props.status];',
    'Object.assign(this.props, record);',
  ])('withholds observable claims for aliased or opaque storage: %s', body => {
    const text = aggregate.replace('  rename():', `  expose(record: { status: Status }): void { ${body} }\n  rename():`);
    expect(terminalStateLeak(setup('', text).ticket)).toEqual([]);
  });
  it('does not trust method replacement inside an unused wrapper member', () => {
    const status = wrapper.replace('  isClosed():', '  replace(): void { this.isClosed = () => false; }\n  isClosed():');
    expect(terminalStateLeak(setup('', aggregate, status).ticket)).toEqual([]);
  });
  it('does not trust factory replacement inside a static wrapper member', () => {
    const status = wrapper.replace('  isClosed():', '  static replace(): void { Status.create = value => new Status(value); }\n  isClosed():');
    expect(terminalStateLeak(setup('', aggregate, status).ticket)).toEqual([]);
  });
  it.each([
    'if (this.props.status) return;',
    'if (!this.props.status) return;',
    'if (this.props.status === Status.create(Stage.open)) return;',
    'if ((this.props.status as unknown) === Stage.open) return;',
    'if ((this.props.status as any) !== Stage.closed) return;',
  ])('keeps whole-wrapper guard semantics unknown: %s', guard => {
    const text = aggregate.replace("  rename():", `  uncertain(): void { ${guard} this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
  it('keeps an unsupported wrapper call in an exit payload unknown', () => {
    const text = aggregate.replace('new Error(this.props.status.value)', 'new Error(String(this.props.status.equals(this.props.status)))');
    expect(describeSources(setup('', text).facts('payload').sources)).toBe('unknown');
  });
  it('does not let a scalar payload read hide an unsupported sibling operation', () => {
    const text = aggregate.replace('new Error(this.props.status.value)', 'new Error(this.props.status.value + String(this.props.status.equals(this.props.status)))');
    expect(describeSources(setup('', text).facts('payload').sources)).toBe('unknown');
  });
  it('does not infer a wrapper predicate through an ordinary aggregate delegate', () => {
    const text = aggregate.replace('  rename():', `  isClosed(): boolean { return this.props.status.isClosed(); }\n  uncertain(): void { if (this.isClosed()) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
});

describe('widened receiver observations', () => {
  it.each(['Status | null', 'Status | undefined', 'Status | { other: string }'])('withholds certainty for an observable %s mutation', type => {
    const extra = `import { Status } from './status'; function poison(s: ${type}): void { (s as any).props.value = 'OPEN'; }`;
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
  it('observes a selected generic base receiver that can hold the wrapper', () => {
    const status = wrapper + `\nfunction poison(s: RecordBase<Props>): void { (s as any).props.value = Stage.open; }`;
    expect(terminalStateLeak(setup('', aggregate, status).ticket)).toEqual([]);
  });
  it('keeps an unrelated generic-base sibling receiver separate', () => {
    const status = wrapper + `\nclass Other extends RecordBase<Props> {} function poison(s: Other): void { (s as any).props.value = Stage.open; }`;
    expect(terminalStateLeak(setup('', aggregate, status).ticket).map(finding => finding.details.method)).toEqual(['rename']);
  });
});

describe('record and construction exposure', () => {
  it.each(['{status: Status} | null', '{inner: {status: Status}}', '{status: Status} | undefined'])('withholds certainty for opaque %s records', type => {
    const extra = `import { Status } from './status'; declare function opaque(value: unknown): void; function poison(p: ${type}): void { opaque(p); }`;
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
  it('rejects an unrelated generic constructor that sends its record to opaque code', () => {
    const extra = `import { Status, Stage } from './status'; declare function opaque(value: unknown): void;
      class Carrier<T> { props: T; constructor(props: T) { opaque(props); this.props = props; } }
      new Carrier({ status: Status.create(Stage.open) });`;
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
  it('observes an any-cast factory replacement inside a wrapper member', () => {
    const status = wrapper.replace('  isClosed():', '  static patch(): void { (Status as any).create = () => new Status(Stage.open); }\n  isClosed():');
    expect(terminalStateLeak(setup('', aggregate, status).ticket)).toEqual([]);
  });
  it('observes an any-cast prototype replacement inside a wrapper member', () => {
    const status = wrapper.replace('  isClosed():', '  static patch(): void { (Status as any).prototype.isClosed = () => false; }\n  isClosed():');
    expect(terminalStateLeak(setup('', aggregate, status).ticket)).toEqual([]);
  });
  it('withholds certainty when a closure captures a wrapper receiver', () => {
    const extra = `import { Status } from './status'; function capture(s: Status): () => boolean { return () => s.isClosed(); }`;
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
});

describe('projected write ordering', () => {
  it('preserves guards before a transparent wrapper setter', () => {
    const text = aggregate.replace('  get status(): Status { return this.props.status; }', '').replace('  close():', `  set selected(value: Status) { this.props.status = value; }\n  close():`).replace('this.props.status = Status.create(Stage.closed); }', 'this.selected = Status.create(Stage.closed); }');
    expect(describeSources(setup('', text).facts('close').sources)).toEqual(['OPEN']);
  });
  it('maps a transparent wrapper setter replacement', () => {
    const text = aggregate.replace('  get status(): Status { return this.props.status; }', '').replace('  close():', `  set selected(value: Status) { this.props.status = value; }\n  close():`).replace('this.props.status = Status.create(Stage.closed); }', 'this.selected = Status.create(Stage.closed); }');
    expect(describeAssigned(setup('', text).facts('close').sets).tokens).toEqual(['CLOSED']);
  });
  it('preserves unknown reads in a replacement RHS', () => {
    const text = aggregate.replace('  rename():', `  uncertain(): void { this.props.status = Status.create(this.props.status.value); if (this.props.status.isClosed()) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
  it('does not grant nested storage writes an overwrite cutoff', () => {
    const text = aggregate.replace('  rename():', `  uncertain(): void { (this.props.status as any).props.value = Stage.open; if (this.props.status.isClosed()) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
  it('does not record a nested storage write as a known whole replacement', () => {
    const text = aggregate.replace('  rename():', `  uncertain(): void { (this.props.status as any).props.value = Stage.open; this.props.title = 'x'; }\n  rename():`);
    expect(describeAssigned(setup('', text).facts('uncertain').sets)).toEqual({ tokens: [], unresolved: false, mayWrite: true });
  });
});

describe('scalar operand purity', () => {
  it('keeps a literal-typed foreign getter comparison unknown', () => {
    const text = aggregate.replace('  rename():', `  uncertain(policy: { get status(): Stage.open }): void { if (this.props.status.value !== policy.status) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
  it('keeps a literal-typed call comparison unknown', () => {
    const text = aggregate.replace('  rename():', `  uncertain(load: () => Stage.open): void { if (this.props.status.value !== load()) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('uncertain').sources)).toBe('unknown');
  });
});

describe('projected outside writes', () => {
  it('maps a directly attributable whole-wrapper outside replacement', () => {
    const extra = `import { Ticket } from './ticket'; import { Status, Stage } from './status';
      function replace(ticket: Ticket): void { (ticket as unknown as {props: {status: Status}}).props.status = Status.create(Stage.closed); }`;
    expect(setup(extra).ticket.outside.map(assignment => describeAssigned(assignment.value).tokens)).toEqual([['CLOSED']]);
  });
  it('does not invent an outside whole-wrapper finding for nested storage mutation', () => {
    const extra = `import { Ticket } from './ticket'; function poison(ticket: Ticket): void { (ticket.status as any).props.value = 'OPEN'; }`;
    expect(setup(extra).ticket.outside).toEqual([]);
  });
});

describe('foreign projected destinations', () => {
  it.each(['this.props.status = Status.create(Stage.closed);', 'this.props.status ||= Status.create(Stage.closed);'])('does not invent a tracked writer for %s on explicit foreign this', body => {
    const text = aggregate.replace('export class Ticket', 'class Other { props!: {status: Status}; }\nexport class Ticket').replace('  rename():', `  foreign(this: Other): void { ${body} }\n  rename():`);
    expect(describeAssigned(setup('', text).facts('foreign').sets)).toEqual({tokens: [], unresolved: false, mayWrite: true});
  });
  it('keeps explicit foreign receiver entry facts unknown', () => {
    const text = aggregate.replace('export class Ticket', 'class Other { props!: {status: Status}; }\nexport class Ticket').replace('  rename():', `  foreign(this: Other): void { this.props.status = Status.create(Stage.closed); }\n  rename():`);
    expect(describeSources(setup('', text).facts('foreign').sources)).toBe('unknown');
  });
});

describe('existing guard shapes over projected scalar reads', () => {
  it('uses the existing switch guard scanner for an exact scalar getter', () => {
    const text = aggregate.replace('  rename():', `  switched(): void { switch (this.props.status.value) { case Stage.closed: return; } this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('switched').sources)).toEqual(['OPEN']);
  });
  it('uses the existing literal includes guard for an exact scalar getter', () => {
    const text = aggregate.replace('  rename():', `  included(): void { if ([Stage.closed].includes(this.props.status.value)) return; this.props.title = 'x'; }\n  rename():`);
    expect(describeSources(setup('', text).facts('included').sources)).toEqual(['OPEN']);
  });
});

describe('observable projection dependencies', () => {
  it.each([
    `import * as model from './status'; (model as any).Status.create = () => new model.Status(model.Stage.open);`,
    `import * as model from './status'; declare const key: string; (model as any)[key].prototype.isClosed = () => false;`,
    `import { Stage } from './status'; (Stage as unknown as Record<string,string>).closed = 'OPEN';`,
    `import { Stage } from './status'; declare function opaque(value: unknown): void; opaque(Stage);`,
  ])('withholds facts when a declaration dependency can change: %s', extra => {
    expect(terminalStateLeak(setup(extra).ticket)).toEqual([]);
  });
  it('retains a pure namespace-qualified factory and enum read', () => {
    const text = aggregate.replace("import { Status, Stage } from './status';", "import { Status, Stage } from './status'; import * as model from './status';").replace('Status.create(Stage.closed)', 'model.Status.create(model.Stage.closed)');
    expect(describeSources(setup('', text).facts('close').sources)).toEqual(['OPEN']);
  });
});
