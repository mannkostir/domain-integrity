import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

type ComparisonCase = {
  readonly name: string;
  readonly domain: string;
  readonly condition: string;
  readonly wrapping?: boolean;
  readonly terminal: string;
  readonly sources: readonly string[];
  readonly leaks: readonly string[];
};

const mixed = "open = 0, closed = '', other = 1";
const strings = "open = '0', closed = '', other = '1'";
const numeric = 'open = 0, closed = 2, other = 3';
const ordinaryStrings = "open = 'OPEN', closed = 'CLOSED', other = 'OTHER'";
const cases: readonly ComparisonCase[] = [
  { name: 'numeric literal-array includes retains strict matching', domain: numeric, condition: '[Stage.closed].includes(this.props.status.value)', terminal: '2', sources: ['0', '3'], leaks: [] },
  { name: 'string literal-array includes retains strict matching', domain: ordinaryStrings, condition: '[Stage.closed].includes(this.props.status.value)', terminal: 'CLOSED', sources: ['OPEN', 'OTHER'], leaks: [] },
  { name: 'mixed equality excludes both zero and empty string', domain: mixed, condition: 'this.props.status.value == Stage.open', terminal: '', sources: ['1'], leaks: [] },
  { name: 'mixed inequality excludes both zero and empty string', domain: mixed, condition: 'this.props.status.value != Stage.open', wrapping: true, terminal: '', sources: ['1'], leaks: [] },
  { name: 'commuted mixed equality retains coercion', domain: mixed, condition: 'Stage.open == this.props.status.value', terminal: '', sources: ['1'], leaks: [] },
  { name: 'mixed equality to empty string also excludes numeric zero', domain: mixed, condition: 'this.props.status.value == Stage.closed', terminal: '0', sources: ['1'], leaks: [] },
  { name: 'mixed inequality to empty string also excludes numeric zero', domain: mixed, condition: 'this.props.status.value != Stage.closed', wrapping: true, terminal: '0', sources: ['1'], leaks: [] },
  { name: 'strict mixed equality keeps the empty string positive', domain: mixed, condition: 'this.props.status.value === Stage.open', terminal: '', sources: ['', '1'], leaks: ['rename'] },
  { name: 'strict mixed inequality keeps the empty string positive', domain: mixed, condition: 'this.props.status.value !== Stage.open', wrapping: true, terminal: '', sources: ['', '1'], leaks: ['rename'] },
  { name: 'string domain equality to numeric zero models coercion', domain: strings, condition: 'this.props.status.value == (0 as unknown as Stage)', terminal: '', sources: ['1'], leaks: [] },
  { name: 'string domain inequality to numeric zero models coercion', domain: strings, condition: 'this.props.status.value != (0 as unknown as Stage)', wrapping: true, terminal: '', sources: ['1'], leaks: [] },
  { name: 'strict string domain comparison does not match numeric zero', domain: strings, condition: 'this.props.status.value === (0 as unknown as Stage)', terminal: '0', sources: ['', '0', '1'], leaks: ['rename'] },
  { name: 'numeric domain equality to string zero models coercion', domain: numeric, condition: "this.props.status.value == ('0' as unknown as Stage)", terminal: '2', sources: ['2', '3'], leaks: ['rename'] },
  { name: 'numeric domain inequality to string zero models coercion', domain: numeric, condition: "this.props.status.value != ('0' as unknown as Stage)", wrapping: true, terminal: '2', sources: ['2', '3'], leaks: ['rename'] },
  { name: 'strict numeric domain comparison does not match string zero', domain: numeric, condition: "this.props.status.value === ('0' as unknown as Stage)", terminal: '0', sources: ['0', '2', '3'], leaks: ['rename'] },
  { name: 'homogeneous numeric equality retains precise sources', domain: numeric, condition: 'this.props.status.value == Stage.open', terminal: '2', sources: ['2', '3'], leaks: ['rename'] },
  { name: 'homogeneous numeric inequality retains precise sources', domain: numeric, condition: 'this.props.status.value != Stage.open', wrapping: true, terminal: '2', sources: ['2', '3'], leaks: ['rename'] },
  { name: 'homogeneous string equality retains precise sources', domain: ordinaryStrings, condition: 'this.props.status.value == Stage.open', terminal: 'CLOSED', sources: ['CLOSED', 'OTHER'], leaks: ['rename'] },
  { name: 'homogeneous string inequality retains precise sources', domain: ordinaryStrings, condition: 'this.props.status.value != Stage.open', wrapping: true, terminal: 'CLOSED', sources: ['CLOSED', 'OTHER'], leaks: ['rename'] },
];

const setup = (test: ComparisonCase) => {
  const body = test.wrapping
    ? `if (${test.condition}) { this.props.title = 'changed'; }`
    : `if (${test.condition}) return; this.props.title = 'changed';`;
  const project = inMemoryProject({
    '/root.ts': AGGREGATE_ROOT,
    '/ticket.ts': `
import { AggregateRoot } from './root';
export enum Stage { ${test.domain} }
class Base<T> { protected readonly props: T; constructor(props: T) { this.props = props; } }
class Status extends Base<{value: Stage}> {
  constructor(value: Stage) { super({value}); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
export class Ticket extends AggregateRoot<{status: Status; title: string}> {
  private constructor(props: {status: Status; title: string}) { super(props); }
  static create(): Ticket { return new Ticket({status: Status.create(Stage.closed), title: ''}); }
  rename(): void { ${body} }
}
`,
  });
  const cls = project.getSourceFileOrThrow('/ticket.ts').getClassOrThrow('Ticket');
  const model = extractLifecycles({
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'status', terminal: [test.terminal], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
  });
  const ticket = model.aggregates.find(aggregate => aggregate.name === 'Ticket')!;
  return { project, ticket };
};

describe.each(cases)('$name', test => {
  const fixture = setup(test);

  it('has no TypeScript diagnostics', () => {
    expect(fixture.project.getPreEmitDiagnostics()).toEqual([]);
  });

  it('retains the actual entry-state partition', () => {
    const sources = fixture.ticket.methods.find(method => method.name === 'rename')!.fields.get('status')!.sources;
    expect(describeSources(sources)).toEqual(test.sources);
  });

  it('reports only a justified terminal leak', () => {
    expect(terminalStateLeak(fixture.ticket).map(finding => finding.details.method)).toEqual(test.leaks);
  });
});
