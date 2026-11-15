import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const wrapper = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
export class Base<T> { protected readonly props: T; constructor(props: T) { this.props = props; } }
export class Status extends Base<Props> {
  constructor(value: Stage) { super({value}); }
  get value(): Stage { return this.props.value; }
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
interface TicketProps { status: Status; title: string }
export class Ticket extends AggregateRoot<TicketProps> {
  constructor(props: TicketProps) { super(props); }
  static restore(props: TicketProps): Ticket { return new Ticket(props); }
  static create(props: TicketProps): Ticket { return Ticket.restore(props); }
  afterClosed(): void { if (!this.props.status.isClosed()) return; this.props.title = 'changed'; }
}
`;

const fixture = (text = ticket, root = AGGREGATE_ROOT) => {
  const project = inMemoryProject({ '/root.ts': root, '/status.ts': wrapper, '/ticket.ts': text });
  expect(project.getPreEmitDiagnostics()).toEqual([]);
  const cls = project.getSourceFileOrThrow('/ticket.ts').getClassOrThrow('Ticket');
  const model = extractLifecycles({ files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/', declaration: {
    ...DEFAULT_DECLARATION,
    lifecycles: [{ target: cls, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: new Map(), allowAfterTerminal: [] }], allowAfterTerminal: [] }],
  } });
  const aggregate = model.aggregates.find(aggregate => aggregate.name === 'Ticket')!;
  expect(aggregate.fields[0]?.values.map(value => value.token)).toEqual(['OPEN', 'CLOSED']);
  return aggregate;
};
const leaks = (text = ticket, root = AGGREGATE_ROOT) => terminalStateLeak(fixture(text, root)).map(finding => finding.details.method);

const forwarded = `${ticket}\ndeclare const props: TicketProps; Ticket.create(props);`;

describe('projected aggregate record forwarding', () => {
  it('retains guarded findings through exact static factory forwarding', () => {
    expect(leaks(forwarded)).toEqual(['afterClosed']);
  });

  it('retains inherited default constructor storage', () => {
    expect(leaks(forwarded.replace('  constructor(props: TicketProps) { super(props); }', ''))).toEqual(['afterClosed']);
  });

  it('retains forwarding through an intermediate aggregate base', () => {
    const text = forwarded.replace('export class Ticket extends AggregateRoot<TicketProps>', 'class Intermediate<P extends object> extends AggregateRoot<P> {}\nexport class Ticket extends Intermediate<TicketProps>');
    expect(leaks(text)).toEqual(['afterClosed']);
  });

  it('retains inert aggregate field initialization', () => {
    const text = forwarded.replace('  constructor(props:', '  private label = ""; private count = 0; private enabled = true; private disabled = false; private empty = null;\n  constructor(props:');
    expect(leaks(text)).toEqual(['afterClosed']);
  });

  it('withholds dispatch when a factory performs an unproved record operation', () => {
    const text = forwarded.replace('return Ticket.restore(props);', 'inspect(props); return Ticket.restore(props);') + '\ndeclare function inspect(value: TicketProps): void;';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when a factory transforms its input record', () => {
    const text = forwarded.replace('return Ticket.restore(props);', 'return Ticket.restore({...props});');
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when a factory forwards a different record', () => {
    const text = forwarded.replace('return Ticket.restore(props);', 'return Ticket.restore(replacement);') + '\ndeclare const replacement: TicketProps;';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch through a cyclic aggregate factory', () => {
    const text = forwarded.replace('return new Ticket(props);', 'return Ticket.create(props);');
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch through an aggregate factory with conditional returns', () => {
    const text = forwarded.replace('return Ticket.restore(props);', 'if (props.title) return Ticket.restore(props); return new Ticket(props);');
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch through a destructured record parameter', () => {
    const text = forwarded.replace('static create(props: TicketProps): Ticket { return Ticket.restore(props); }', 'static create({status, title}: TicketProps): Ticket { return new Ticket({status, title}); }');
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when constructor forwarding has an additional operation', () => {
    const text = forwarded.replace('super(props);', 'super(props); inspect(props);') + '\ndeclare function inspect(value: TicketProps): void;';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when aggregate initialization evaluates an unknown call', () => {
    const text = forwarded.replace('  constructor(props:', '  private label = initialize();\n  constructor(props:') + '\ndeclare function initialize(): string;';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when aggregate storage copies instead of forwarding its input', () => {
    const text = forwarded.replace('super(props);', 'super({...props});');
    expect(leaks(text)).toEqual([]);
  });

  it('withholds dispatch when root storage aliases a different record', () => {
    const root = AGGREGATE_ROOT.replace('this.props = props;', 'this.props = replacement(props);') + '\ndeclare function replacement<P>(value: P): P;';
    expect(leaks(forwarded, root)).toEqual([]);
  });
});

describe('projected implementation flow through records', () => {
  it('withholds sibling dispatch flowing through an array element', () => {
    const text = ticket + '\nconst statuses: Status[] = [new Other(Stage.closed)];\nTicket.create({status: statuses[0]!, title: ""});';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds sibling dispatch flowing through a generic carrier', () => {
    const text = ticket + '\ninterface Carrier<T> { current: T }\nconst carrier: Carrier<Status> = {current: new Other(Stage.closed)};\nTicket.create({status: carrier.current, title: ""});';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds sibling dispatch flowing through an intersection record', () => {
    const text = ticket + '\nconst record: {current: Status} & {label: string} = {current: new Other(Stage.closed), label: ""};\nTicket.create({status: record.current, title: ""});';
    expect(leaks(text)).toEqual([]);
  });

  it('withholds sibling dispatch hidden by an optional carrier property assertion', () => {
    const text = ticket + '\ninterface Carrier { current?: Status }\nconst carrier: Carrier = {current: new Other(Stage.closed)};\nTicket.create({status: carrier.current!, title: ""});';
    expect(leaks(text)).toEqual([]);
  });
});
