import { runInNewContext } from 'node:vm';
import { ts } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const order = `export class Order {
  closed: boolean = false;
  label = '';
  isClosed() { return false; }
  rename() { if (this.isClosed()) return; this.label = 'renamed'; }
  unguarded() { this.label = 'unguarded'; }
}
const instance = new Order();`;

type Fixture = {
  readonly name: string;
  readonly text: string;
  readonly runtime: string;
  readonly expected: readonly string[] | 'unknown';
  readonly guarded: string;
  readonly terminal?: string;
  readonly runtimeTerminal?: string;
  readonly extra?: Readonly<Record<string, string>>;
};

const containers = [
  ['returned tuple', '[() => Order, number]', '[() => instance, 1]', 'make()[0]()', '[() => Order, object]', '[() => instance, instance]', 'make()[1]'],
  ['string indexed return', '{ [key: string]: () => Order }', '{ entry: () => instance }', 'make().entry()', '{ [key: string]: (() => Order) | object }', '{ entry: () => instance, hidden: instance }', 'make().hidden'],
  ['number indexed return', '{ [key: number]: () => Order }', '{ 0: () => instance }', 'make()[0]()', '{ [key: number]: (() => Order) | object }', '{ 0: () => instance, 1: instance }', 'make()[1]'],
  ['interface callable return', 'Callable', 'Object.assign(() => instance, { tag: 1 })', 'make()()', 'ErasedCallable', 'Object.assign(() => instance, { hidden: instance })', 'make().hidden'],
] as const;
const containerFixtures: readonly Fixture[] = containers.flatMap(([name, safeType, safeValue, safeUse, unsafeType, unsafeValue, unsafeUse]) => {
  const prefix = `${order}\ninterface Callable { (): Order; tag: number }\ninterface ErasedCallable { (): Order; hidden: object }`;
  return [
    { name: `${name} preserved`, text: `${prefix}\ndeclare function make(): ${safeType};\n${name === 'returned tuple' ? 'make().length;' : name === 'number indexed return' ? 'make().toString();' : `${safeUse}.rename();`}`, runtime: `${prefix}\nfunction make(): ${safeType} { return ${safeValue}; }\n${name === 'returned tuple' ? 'make().length;' : name === 'number indexed return' ? 'make().toString();' : `${safeUse}.rename();`}`, expected: ['false', 'true'], guarded: 'renamed' },
    { name: `${name} erased`, text: `${prefix}\ndeclare function make(): ${unsafeType};\ndeclare function opaque(payload: { target: object }): void;\nopaque({ target: ${unsafeUse} });`, runtime: `${prefix}\nfunction make(): ${unsafeType} { return ${unsafeValue}; }\nfunction opaque(payload: { target: object }) { Object.defineProperty(payload.target, 'isClosed', { value: () => true }); }\nopaque({ target: ${unsafeUse} });`, expected: 'unknown', guarded: '' },
  ];
});

const prototypeFixtures: readonly Fixture[] = ['(Object.getPrototypeOf)', '(Object)!.getPrototypeOf', '(Object.getPrototypeOf)!'].flatMap(operation => [
  { name: `${operation} primitive acquisition`, text: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nconst prototype = ${operation}(1);`, runtime: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nconst prototype = ${operation}(1);`, expected: ['true'], guarded: 'renamed' },
  { name: `${operation} array acquisition`, text: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nconst prototype = ${operation}([]);\nprototype.includes = () => true;`, runtime: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nconst prototype = ${operation}([]);\nprototype.includes = () => true;`, expected: 'unknown', guarded: '' },
]);

const primitiveSource = (work: string, rootConstructor = '', derivedConstructor = '') => `
abstract class Root<P extends object> {
  protected props!: P;
  private buffer: object[] = [];
  ${rootConstructor}
  protected record(payload: object) { this.buffer.push(payload); }
}
export class Order extends Root<{ closed: boolean }> {
  closed: boolean = false; label = ''; private tags: string[] = ['initial'];
  ${derivedConstructor}
  isClosed() { return false; }
  rename() { if (this.isClosed()) return; this.label = 'renamed'; }
  unguarded() { this.label = 'unguarded'; }
  notify() { this.record({ kind: 'changed' }); }
  ${work}
}
`;
const primitiveCases = [
  ['literal append', "append() { this.tags.push('ready'); }", ['false', 'true']],
  ['required primitive append', 'append(value: string) { this.tags.push(value); }', ['false', 'true']],
  ['default primitive append', "append(value: string = 'ready') { this.tags.push(value); }", 'unknown'],
  ['optional primitive append', 'append(value?: string) { if (value !== undefined) this.tags.push(value); }', 'unknown'],
  ['rest primitive append', 'append(...values: string[]) { this.tags.push(...values); }', 'unknown'],
  ['reassigned primitive append', "append(value: string) { value = 'changed'; this.tags.push(value); }", 'unknown'],
] as const;
const primitiveFixtures: readonly Fixture[] = [
  ...primitiveCases.map(([name, work, expected]) => ({ name, text: primitiveSource(work), runtime: `${primitiveSource(work)}\nconst instance = new Order(); instance.notify(); instance.append(${name === 'literal append' ? '' : "'ready'"});`, expected, guarded: 'renamed' })),
  { name: 'primitive constructor and super transfer', text: `${primitiveSource('', 'private mode: string; constructor(mode: string) { this.mode = mode; }', 'constructor(mode: string) { super(mode); }')}\nconst instance = new Order('ready');`, runtime: `${primitiveSource('', 'private mode: string; constructor(mode: string) { this.mode = mode; }', 'constructor(mode: string) { super(mode); }')}\nconst instance = new Order('ready'); instance.notify();`, expected: ['false', 'true'], guarded: 'renamed' },
];

const enumBase = order.replace('closed: boolean = false;', "closed: 'open' | 'closed' = 'open';").replace('return false;', 'return this.closed === State.Open;');
const enumDeclaration = "export enum State { Open = 'open', Closed = 'closed' }";
const enumFixtures: readonly Fixture[] = [
  {
    name: 'type-only enum identity beside selected member',
    text: `import { State } from './state';\n${enumBase}`,
    extra: { '/state.ts': enumDeclaration, '/types.ts': "import type { State } from './state'; export type Selected = State.Open; export type { State };" },
    runtime: `${enumDeclaration}\n${enumBase}`,
    expected: ['closed'], terminal: 'closed', runtimeTerminal: "'closed'", guarded: 'renamed',
  },
  {
    name: 'live enum object replacement beside selected member',
    text: `import { State } from './state';\n${enumBase}\ndeclare function opaque(value: object): void; opaque(State);`,
    extra: { '/state.ts': enumDeclaration, '/types.ts': "import type { State } from './state'; export type Selected = State.Open; export type { State };" },
    runtime: `${enumDeclaration}\n${enumBase}\nfunction opaque(value: object) { Object.defineProperty(value, 'Open', { value: 'closed' }); } opaque(State);`,
    expected: 'unknown', terminal: 'closed', runtimeTerminal: "'closed'", guarded: '',
  },
];

const callableUnionFixtures: readonly Fixture[] = [
  {
    name: 'nullable nominal factory union alias',
    text: `${order}\ndeclare const make: (() => Order) | (() => Order | null); const alias = make; alias()?.rename();`,
    runtime: `${order}\nconst make: (() => Order) | (() => Order | null) = () => instance; const alias = make; alias()?.rename();`,
    expected: ['false', 'true'], guarded: 'renamed',
  },
  {
    name: 'erased factory union alias',
    text: `${order}\ndeclare const make: (() => Order) | (() => object); const alias = make; declare function opaque(value: object): void; opaque(alias());`,
    runtime: `${order}\nconst make: (() => Order) | (() => object) = () => instance; const alias = make; function opaque(value: object) { Object.defineProperty(value, 'isClosed', { value: () => true }); } opaque(alias());`,
    expected: 'unknown', guarded: '',
  },
];

const returnedUnionFixtures: readonly Fixture[] = [
  {
    name: 'returned nominal record or callable union',
    text: `${order}\ndeclare function make(): { get(): Order } | (() => Order); make().toString();`,
    runtime: `${order}\nfunction make(): { get(): Order } | (() => Order) { return { get: () => instance }; } make().toString();`,
    expected: ['false', 'true'], guarded: 'renamed',
  },
  {
    name: 'returned union with erased receiver member',
    text: `${order}\ndeclare function make(): { get(): Order } | { get(): object }; declare function opaque(value: object): void; opaque(make().get());`,
    runtime: `${order}\nfunction make(): { get(): Order } | { get(): object } { return { get: () => instance }; } function opaque(value: object) { Object.defineProperty(value, 'isClosed', { value: () => true }); } opaque(make().get());`,
    expected: 'unknown', guarded: '',
  },
  {
    name: 'primitive union prototype acquisition',
    text: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nfunction acquire(input: string | number) { return (Object.getPrototypeOf)(input); } acquire(1);`,
    runtime: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nfunction acquire(input: string | number) { return (Object.getPrototypeOf)(input); } acquire(1);`,
    expected: ['true'], guarded: 'renamed',
  },
  {
    name: 'array constituent in prototype acquisition union',
    text: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nfunction acquire(input: string | unknown[]) { return (Object.getPrototypeOf)(input); } const prototype = acquire([]); prototype.includes = () => true;`,
    runtime: `${order.replace('return false;', 'return [false].includes(this.closed);')}\nfunction acquire(input: string | unknown[]) { return (Object.getPrototypeOf)(input); } const prototype = acquire([]); prototype.includes = () => true;`,
    expected: 'unknown', guarded: '',
  },
];

const inspect = (fixture: Fixture) => {
  const project = inMemoryProject({ '/order.ts': fixture.text, ...fixture.extra });
  const files = ['/order.ts', ...Object.keys(fixture.extra ?? {})].map(path => project.getSourceFileOrThrow(path));
  const target = files[0]!.getClassOrThrow('Order');
  const model = extractLifecycles({
    declaration: { ...DEFAULT_DECLARATION, eventMethods: ['record'], lifecycles: [{ target, fields: [{ name: 'closed', terminal: [fixture.terminal ?? 'true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files, projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates.find(candidate => candidate.name === 'Order')!;
  const runtimeProject = inMemoryProject({ '/runtime.ts': fixture.runtime });
  const runtime = ts.transpileModule(`${fixture.runtime}\ninstance.closed = ${fixture.runtimeTerminal ?? 'true'}; instance.label = ''; instance.rename(); const guarded = instance.label; instance.unguarded(); ({ guarded, unguarded: instance.label });`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return {
    diagnostics: project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText()),
    runtimeDiagnostics: runtimeProject.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText()),
    problems: model.problems,
    sources: describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources),
    findings: terminalStateLeak(aggregate).map(finding => finding.details.method),
    runtime: runInNewContext(runtime, { exports: {} }) as { readonly guarded: string; readonly unguarded: string },
  };
};

describe.each([...containerFixtures, ...prototypeFixtures, ...primitiveFixtures, ...enumFixtures, ...callableUnionFixtures, ...returnedUnionFixtures])('$name', fixture => {
  let result: ReturnType<typeof inspect>;
  beforeAll(() => { result = inspect(fixture); });

  it('has valid analysis input', () => {
    expect(result.diagnostics).toEqual([]);
  });
  it('has valid authored runtime input', () => {
    expect(result.runtimeDiagnostics).toEqual([]);
  });
  it('extracts without problems', () => {
    expect(result.problems).toEqual([]);
  });
  it('retains the expected guarded sources', () => {
    expect(result.sources).toEqual(fixture.expected);
  });
  it('retains the deliberate unguarded finding', () => {
    expect(result.findings).toContain('unguarded');
  });
  it('retains the expected guarded finding decision', () => {
    expect(result.findings.includes('rename')).toBe(Array.isArray(fixture.expected) && fixture.expected.includes(fixture.terminal ?? 'true'));
  });
  it('observes the authored guarded write behavior', () => {
    expect(result.runtime.guarded).toBe(fixture.guarded);
  });
  it('observes the deliberately unguarded runtime write', () => {
    expect(result.runtime.unguarded).toBe('unguarded');
  });
});
