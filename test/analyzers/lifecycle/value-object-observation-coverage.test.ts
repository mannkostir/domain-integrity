import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const wrapper = `
export enum Stage { open = 'OPEN', closed = 'CLOSED' }
interface Props { value: Stage }
class Base<T> { protected readonly props: T; constructor(props: T) { this.props = props; } }
export class Status extends Base<Props> {
  constructor(value: Stage) { if (!Object.values(Stage).includes(value)) throw new Error('invalid'); super({value}); }
  get value(): Stage { return this.props.value; }
  static create(value: Stage): Status { return new Status(value); }
  isClosed(): boolean { return this.props.value === Stage.closed; }
}
`;
const ticket = `
import { AggregateRoot } from './root';
import { Status, Stage } from './status';
export class Ticket extends AggregateRoot<{status: Status; title: string}> {
  constructor(props: {status: Status; title: string}) { super(props); }
  get status(): Status { return this.props.status; }
  afterClosed(): void { if (!this.props.status.isClosed()) return; this.props.title = 'changed'; }
  rename(): void { this.props.title = 'changed'; }
}
`;
const view = `
interface View { readonly value: Stage; isClosed(): boolean }
class Independent { value: Stage = Stage.closed; isClosed(): boolean { return false; } }
`;
const analyze = (extra: string, status = wrapper, files: Readonly<Record<string, string>> = {}) => {
  const project = inMemoryProject({ '/root.ts': AGGREGATE_ROOT, '/status.ts': status, '/ticket.ts': ticket + view + extra, ...files });
  const cls = project.getSourceFileOrThrow('/ticket.ts').getClassOrThrow('Ticket');
  const model = extractLifecycles({ files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/', declaration: {
    ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'status', terminal: ['CLOSED'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
  } });
  const aggregate = model.aggregates.find(item => item.name === 'Ticket')!;
  expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  expect(aggregate.fields[0]?.values.map(value => value.token)).toEqual(['OPEN', 'CLOSED']);
  return terminalStateLeak(aggregate).map(finding => finding.details.method);
};

describe('structural carrier observation', () => {
  it('isolates a const carrier that only contains an independent receiver', () => {
    const extra = `const carrier: {status: View} = {status: new Independent()};
      function poison(p: {status: View}): void { p.status.isClosed = () => false; }
      poison(carrier);`;

    expect(analyze(extra)).toEqual(['afterClosed', 'rename']);
  });

  it('withholds dispatch after a const carrier member is replaced with stored status', () => {
    const extra = `declare const ticket: Ticket;
      const carrier: {status: View} = {status: new Independent()};
      carrier.status = ticket.status;
      function poison(p: {status: View}): void { p.status.isClosed = () => false; }
      poison(carrier);`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds dispatch through a mutable carrier even when its initial value is independent', () => {
    const extra = `declare const ticket: Ticket;
      let carrier: {status: View} = {status: new Independent()};
      carrier = ticket;
      function poison(p: {status: View}): void { p.status.isClosed = () => false; }
      poison(carrier);`;

    expect(analyze(extra)).toEqual([]);
  });

  it('isolates a structural writer forwarded through a union carrier with independent receivers', () => {
    const extra = `function poison(p: {status: View} | {status: Independent; label: string}): void { p.status.isClosed = () => false; }
      poison({status: new Independent()});`;

    expect(analyze(extra)).toEqual(['afterClosed', 'rename']);
  });

  it('withholds dispatch when a union carrier includes stored status', () => {
    const extra = `declare const ticket: Ticket;
      function poison(p: {status: View} | {status: Independent; label: string}): void { p.status.isClosed = () => false; }
      poison(ticket);`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds dispatch through a computed borrowed carrier member', () => {
    const extra = `declare const ticket: Ticket;
      function poison(p: {status: View; spare: View}, key: 'status' | 'spare'): void { p[key].isClosed = () => false; }
      poison({status: ticket.status, spare: new Independent()}, 'status');`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds dispatch through a spread carrier containing stored status', () => {
    const extra = `declare const ticket: Ticket;
      const source: {status: View} = ticket;
      function poison(p: {status: View}): void { p.status.isClosed = () => false; }
      poison({...source});`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds dispatch when an opaque call receives a wrapper through two structural parameters', () => {
    const extra = `declare const ticket: Ticket;
      declare function opaque(value: unknown): void;
      function forward(value: unknown): void { opaque(value); }
      function expose(value: View): void { forward(value); }
      expose(ticket.status);`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds dispatch when a wrapper escapes through a const structural alias', () => {
    const extra = `declare const ticket: Ticket;
      declare function opaque(value: unknown): void;
      function expose(value: View): void { const alias: unknown = value; opaque(alias); }
      expose(ticket.status);`;

    expect(analyze(extra)).toEqual([]);
  });

  it('isolates a write to the unrelated prototype', () => {
    expect(analyze('Independent.prototype.isClosed = () => false;')).toEqual(['afterClosed', 'rename']);
  });
});

describe('fresh project receiver identity', () => {
  it('isolates a directly fresh receiver with an inherited constructor', () => {
    const extra = `class Child extends Independent {}
      const fresh = new Child(); fresh.isClosed = () => false;`;

    expect(analyze(extra)).toEqual(['afterClosed', 'rename']);
  });

  it('withholds freshness when a constructor can return stored status', () => {
    const extra = `declare const ticket: Ticket;
      class Borrowed { value: Stage = Stage.closed; isClosed(): boolean { return true; }
        constructor() { return ticket.status; }
      }
      const fresh = new Borrowed(); fresh.isClosed = () => false;`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds freshness after the constructor binding escapes', () => {
    const extra = `const Constructor = Independent;
      const fresh = new Constructor(); fresh.isClosed = () => false;`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds freshness for a class with an unresolved ambient base', () => {
    const extra = `declare class External { value: Stage; isClosed(): boolean; }
      class Child extends External {}
      const fresh = new Child(); fresh.isClosed = () => false;`;

    expect(analyze(extra)).toEqual([]);
  });

  it('withholds freshness when the class definition has a static effect', () => {
    const extra = `class Child extends Independent { static { Object.defineProperty(this.prototype, 'isClosed', {value: () => false}); } }
      const fresh = new Child(); fresh.isClosed = () => false;`;

    expect(analyze(extra)).toEqual([]);
  });
});

describe('validation dependency observation', () => {
  it.each([
    'const library = Array;',
    'const library = Object;',
    'void Array["prototype"];',
    'void Object["values"];',
    'Object.values = () => [];',
    'declare function opaque(value: unknown): void; opaque(Array);',
    'declare function opaque(value: unknown): void; opaque(Object);',
  ])('withholds validation-dependent facts after %s', operation => {
    expect(analyze(operation)).toEqual([]);
  });

  it('retains facts for ordinary library reflection that does not expose the constructors', () => {
    expect(analyze('void Object.keys({title: "safe"}); void Array.isArray([]);')).toEqual(['afterClosed', 'rename']);
  });

  it('withholds facts when a re-exporting module namespace escapes', () => {
    expect(analyze(`import * as domain from './barrel'; declare function opaque(value: unknown): void; opaque(domain);`, wrapper, {
      '/barrel.ts': `export * from './status';`,
    })).toEqual([]);
  });

  it('retains facts for a qualified enum read through a re-export', () => {
    expect(analyze(`import * as domain from './barrel'; const closed = domain.Stage.closed; void closed;`, wrapper, {
      '/barrel.ts': `export * from './status';`,
    })).toEqual(['afterClosed', 'rename']);
  });
});
