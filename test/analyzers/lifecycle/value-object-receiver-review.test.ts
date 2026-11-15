import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { transitionDrift } from '../../../src/analyzers/lifecycle/checks/transition-drift';
import { unreachableState } from '../../../src/analyzers/lifecycle/checks/unreachable-state';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const status = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
export class Base<T> { protected readonly props: T; constructor(props: T) { this.props = props; } }
export class Status extends Base<Props> {
  constructor(value: Stage) { super({value}); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  static fromPersistence(value: string): Status { return new Status(value as Stage); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
export class Other extends Base<Props> {
  constructor(value: Stage) { super({value}); }
  get value(): Stage { return Stage.closed; }
  isClosed(): boolean { return false; }
}
`;
const ticket = `
import { AggregateRoot } from './root';
import { Status, Other, Stage } from './status';
export class Ticket extends AggregateRoot<{status: Status; title: string}> {
  private constructor(props: {status: Status; title: string}) { super(props); }
  static create(): Ticket { return new Ticket({status: Status.create(Stage.closed), title: 'unchanged'}); }
  get status(): Status { return this.props.status; }
  afterClosed(): void { if (!this.props.status.isClosed()) return; this.props.title = 'changed'; }
}
`;
const fixture = (text = ticket, extra = '', declared = true, wrapper = status, terminal = 'CLOSED') => {
  const project = inMemoryProject({ '/root.ts': AGGREGATE_ROOT, '/status.ts': wrapper, '/ticket.ts': text + extra });
  const cls = project.getSourceFileOrThrow('/ticket.ts').getClassOrThrow('Ticket');
  const model = extractLifecycles({ files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/', declaration: {
    ...DEFAULT_DECLARATION, lifecycles: declared ? [{ target: cls, fields: [{ name: 'status', terminal: [terminal], transitions: new Map([['afterClosed', [terminal]]]), allowAfterTerminal: [] }], allowAfterTerminal: [] }] : [],
  } });
  return { project, model, aggregate: model.aggregates.find(aggregate => aggregate.name === 'Ticket')! };
};
const sibling = ticket.replace('Status.create(Stage.closed)', 'new Other(Stage.closed)');
const writer = (view: string) => ticket.replace("return new Ticket({status: Status.create(Stage.closed), title: 'unchanged'});", "const ticket = new Ticket({status: Status.create(Stage.closed), title: 'unchanged'}); poison(ticket); return ticket;") + '\n' + view + '\nfunction poison(p: {status: View}): void { p.status.isClosed = () => false; }';
const views = [
  'interface View { readonly value: Stage; isClosed(): boolean; }',
  'class View { readonly value: Stage = Stage.open; isClosed(): boolean { return false; } }',
  'type View = { readonly value: Stage; isClosed(): boolean } & object;',
];

describe('observed runtime implementation identity', () => {
  it('keeps the sibling substitution diagnostic clean', () => {
    expect(fixture(sibling).project.getPreEmitDiagnostics()).toEqual([]);
  });
  it('withholds the false leak when a compatible sibling initializes selected storage', () => {
    expect(terminalStateLeak(fixture(sibling).aggregate)).toEqual([]);
  });
  it('withholds the false leak after a compatible sibling whole-slot replacement', () => {
    const text = ticket.replace('  afterClosed():', '  private install(): void { this.props.status = new Other(Stage.closed); }\n  afterClosed():');
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('keeps the exact Status positive with the same unused sibling declaration', () => {
    expect(terminalStateLeak(fixture().aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
  it('retains the finite state field when sibling dispatch is unknown', () => {
    expect(fixture(sibling).aggregate.fields[0]?.values.map(value => value.token)).toEqual(['OPEN', 'CLOSED']);
  });
  it('does not invent declared source drift for the substituted receiver', () => {
    expect(transitionDrift(fixture(sibling).aggregate)).toEqual([]);
  });
  it('does not invent reachability for the substituted receiver', () => {
    expect(unreachableState(fixture(sibling).aggregate)).toEqual([]);
  });
  it('does not infer terminal states for the substituted receiver', () => {
    expect(suggestLifecycles(fixture(sibling, '', false).model)[0]?.fields[0]?.terminal).toEqual([]);
  });
  it('keeps broad persistence scalar input separate from dispatch safety', () => {
    const text = ticket.replace('Status.create(Stage.closed)', 'Status.fromPersistence(value)').replace('static create():', 'static create(value: string):');
    expect(terminalStateLeak(fixture(text).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
});

describe('structural writer exposure', () => {
  it.each(views)('keeps the structural writer diagnostic clean: %s', view => {
    expect(fixture(writer(view)).project.getPreEmitDiagnostics()).toEqual([]);
  });
  it.each(views)('withholds false leaks through an observed structural view: %s', view => {
    expect(terminalStateLeak(fixture(writer(view)).aggregate)).toEqual([]);
  });
  it('keeps an aggregate getter used only for scalar reads admissible', () => {
    const text = writer(views[0]!).replace('p.status.isClosed = () => false;', 'void p.status.value;');
    expect(terminalStateLeak(fixture(text).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
  it('isolates an inline fresh structural receiver from the selected wrapper', () => {
    const text = writer(views[0]!).replace('poison(ticket);', 'poison({status: new Other(Stage.closed)});');
    expect(terminalStateLeak(fixture(text).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
  it('does not assume a library-returned carrier is fresh', () => {
    const text = writer(views[0]!).replace('poison(ticket);', 'poison(dictionary());') + '\ndeclare function dictionary(): {status: View};';
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('isolates a concrete unrelated fresh structural receiver', () => {
    const extra = '\nclass View { value: Stage = Stage.closed; isClosed(): boolean { return false; } }\nconst fresh = new View(); fresh.isClosed = () => false;';
    expect(terminalStateLeak(fixture(ticket, extra).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
});

describe('structural reflective writes', () => {
  it.each([
    'Reflect.set(p.status, "isClosed", () => false);',
    'Reflect.set({}, "isClosed", () => false, p.status);',
    'Object.assign(p.status, {isClosed: () => false});',
    'Object.defineProperty(p.status, "isClosed", {value: () => false});',
    'Object.defineProperties(p.status, {isClosed: {value: () => false}});',
  ])('withholds dispatch after %s', body => {
    const text = writer(views[0]!).replace('p.status.isClosed = () => false;', body);
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('keeps method-only interface writes unknown through an unbound invocation', () => {
    const text = writer('interface View { isClosed(): boolean; }').replace('poison(ticket);', 'poison.call(undefined, ticket);');
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('keeps nullable local evidence separate from a nonnullable selected field', () => {
    expect(terminalStateLeak(fixture(ticket, '\nconst optional: Status | null = null;').aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
});

describe('erased storage implementation changes', () => {
  it.each([
    'Reflect.set((ticket as any).props, "status", new Other(Stage.closed));',
    'Object.assign((ticket as any).props, {status: new Other(Stage.closed)});',
    'Object.defineProperty((ticket as any).props, "status", {value: new Other(Stage.closed)});',
    '(ticket as any).props.status = new Other(Stage.closed);',
  ])('withholds sibling dispatch installed through %s', operation => {
    const text = ticket.replace("return new Ticket({status: Status.create(Stage.closed), title: 'unchanged'});", `const ticket = new Ticket({status: Status.create(Stage.closed), title: 'unchanged'}); ${operation} return ticket;`);
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('keeps a known original implementation in an attributable whole-slot replacement', () => {
    const text = ticket.replace("return new Ticket({status: Status.create(Stage.closed), title: 'unchanged'});", 'const ticket = new Ticket({status: Status.create(Stage.closed), title: "unchanged"}); (ticket as unknown as {props: {status: Status}}).props.status = Status.create(Stage.closed); return ticket;');
    expect(terminalStateLeak(fixture(text).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
});


describe('unproved numeric predicate domains', () => {
  it('withholds token-only receiver predicates over NaN', () => {
    const text = status.replace("open = 'OPEN', closed = 'CLOSED'", 'open = 0, closed = NaN');
    expect(terminalStateLeak(fixture(ticket, '', true, text, 'NaN').aggregate)).toEqual([]);
  });
});

describe('unproved incoming receiver evidence', () => {
  it('does not trust a missing wrapper hidden by an aggregate props assertion', () => {
    const text = ticket.replace("{status: Status.create(Stage.closed), title: 'unchanged'}", '{} as any');
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('withholds a structural wrapper passed to opaque code', () => {
    const text = writer(views[0]!).replace('p.status.isClosed = () => false;', 'opaque(p.status);') + '\ndeclare function opaque(value: View): void;';
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
  it('withholds a known wrapper passed through an erased structural parameter', () => {
    const text = writer('type View = any;').replace('p.status.isClosed = () => false;', 'opaque(p.status);') + '\ndeclare function opaque(value: unknown): void;';
    expect(terminalStateLeak(fixture(text).aggregate)).toEqual([]);
  });
});

describe('independent concrete receiver isolation', () => {
  it('does not treat an unrelated class instance method as a selected wrapper writer', () => {
    const extra = '\nclass View { value: Stage = Stage.closed; isClosed(): boolean { return false; } mutate(): void { this.isClosed = () => false; } }';
    expect(terminalStateLeak(fixture(ticket, extra).aggregate).map(finding => finding.details.method)).toEqual(['afterClosed']);
  });
});

const borrowedHolder = ticket.replace("return new Ticket({status: Status.create(Stage.closed), title: 'unchanged'});", "const ticket = new Ticket({status: Status.create(Stage.closed), title: 'unchanged'}); new Holder(ticket.view).mutate(); return ticket;").replace('  afterClosed():', '  get view(): View { return this.props.status; }\n  afterClosed():') + `
interface View { readonly value: Stage; isClosed(): boolean; }
class Holder {
  constructor(private readonly borrowed: View) {}
  mutate(): void { this.borrowed.isClosed = () => false; }
}
`;

describe('fresh holder with borrowed structural storage', () => {
  it('keeps the fresh holder alias regression diagnostic clean', () => {
    expect(fixture(borrowedHolder).project.getPreEmitDiagnostics()).toEqual([]);
  });
  it('does not inherit fresh holder identity for its borrowed wrapper', () => {
    expect(terminalStateLeak(fixture(borrowedHolder).aggregate)).toEqual([]);
  });
  it('retains the selected finite domain for the fresh holder alias', () => {
    expect(fixture(borrowedHolder).aggregate.fields[0]?.values.map(value => value.token)).toEqual(['OPEN', 'CLOSED']);
  });
});
