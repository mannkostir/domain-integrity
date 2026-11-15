import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { openConfig, addLifecycles } from '../../../src/cli/config-writer';
import { moduleSpecifiers } from '../../../src/cli/module-specifier';
import { readDeclaration } from '../../../src/engine/read-config';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const source = `
import { AggregateRoot } from './root';
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
class Base<T> { protected readonly props: T; constructor(props: T) { this.props = props; } }
export class Status extends Base<{ value: Stage }> {
  constructor(value: Stage) { super({ value }); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
export class Ticket extends AggregateRoot<{status: Status; title: string}> {
  constructor(props: {status: Status; title: string}) { super(props); }
  static create(): Ticket { return new Ticket({ status: Status.create(Stage.open), title: '' }); }
  close(): void { if (this.props.status.isClosed()) return; this.props.status = Status.create(Stage.closed); }
  cancel(): void { const previous = this.props.status.value; this.props.status = Status.create(Stage.closed); }
  rename(): void { this.props.title = 'x'; }
}
`;
const setup = (extra = '') => {
  const project = inMemoryProject({ '/root.ts': AGGREGATE_ROOT, '/ticket.ts': source + extra });
  const config = openConfig(project, '/domain.config.ts');
  const extract = () => extractLifecycles({ files: project.getSourceFiles(), configFile: config, declaration: DEFAULT_DECLARATION, projectRoot: '/', repositoryRoot: '/' });
  return { project, config, extract };
};

describe('projected init', () => {
  it('discovers the original scalar enum metadata', () => {
    const field = suggestLifecycles(setup().extract())[0]!.fields[0]!.field;
    expect(field.enumReference).toEqual({ name: 'Stage', file: '/ticket.ts' });
  });
  it('withholds transition inference for the pre-write snapshot', () => {
    const field = suggestLifecycles(setup().extract())[0]!.fields[0]!;
    expect(field.transitions).toEqual({ kind: 'withheld', methods: [{ method: 'cancel', reason: 'unknown-sources' }] });
  });
  it('does not invent terminal states when snapshot writer sources are unknown', () => {
    expect(suggestLifecycles(setup().extract())[0]!.fields[0]!.terminal).toEqual([]);
  });
  it('renders a reviewed primitive enum terminal through the existing writer', () => {
    const fixture = setup();
    const suggestions = suggestLifecycles(fixture.extract());
    const suggestion = suggestions[0]!;
    const field = suggestion.fields[0]!;
    addLifecycles(fixture.config, 'domain.config.ts', moduleSpecifiers(fixture.project), [{ ...suggestion, fields: [{ ...field, terminal: [field.field.values[1]!] }] }]);
    expect(fixture.config.getFullText()).toContain('status: { terminal: Stage.closed }');
  });
  it('typechecks the generated primitive enum configuration', () => {
    const fixture = setup();
    const suggestion = suggestLifecycles(fixture.extract())[0]!;
    const field = suggestion.fields[0]!;
    addLifecycles(fixture.config, 'domain.config.ts', moduleSpecifiers(fixture.project), [{ ...suggestion, fields: [{ ...field, terminal: [field.field.values[1]!] }] }]);
    expect(fixture.config.getPreEmitDiagnostics()).toEqual([]);
  });
  it('statically accepts the primitive enum terminal without a new configuration shape', () => {
    const fixture = setup();
    const suggestion = suggestLifecycles(fixture.extract())[0]!;
    const field = suggestion.fields[0]!;
    addLifecycles(fixture.config, 'domain.config.ts', moduleSpecifiers(fixture.project), [{ ...suggestion, fields: [{ ...field, terminal: [field.field.values[1]!] }] }]);
    const declaration = readDeclaration(fixture.config, 'domain.config.ts').declaration;
    const model = extractLifecycles({ files: fixture.project.getSourceFiles(), configFile: fixture.config, declaration, projectRoot: '/', repositoryRoot: '/' });
    expect(model.problems).toEqual([]);
  });
  it('excludes static configuration from observable use analysis', () => {
    const fixture = setup();
    fixture.config.addStatements("import { Status } from './ticket'; Status.prototype.isClosed = () => false;");
    const aggregate = fixture.extract().aggregates[0]!;
    expect(aggregate.methods.find(method => method.name === 'close')?.fields.get('status')?.sources.kind).toBe('known');
  });
  it('withholds inference when a prototype replacement is observed in project source', () => {
    const suggestion = suggestLifecycles(setup('\nStatus.prototype.isClosed = () => false;').extract())[0]!;
    expect(suggestion.fields[0]!.terminal).toEqual([]);
  });
});
