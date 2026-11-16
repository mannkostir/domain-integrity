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

const originBoundary = (name: string, text: string, expected: readonly string[] | 'unknown', step = ''): Fixture => ({
  name,
  text,
  runtime: `${text}\nconst instance = new Order(); instance.notify(); ${step}`,
  expected,
  guarded: 'renamed',
});
const originBoundaryFixtures: readonly Fixture[] = [
  originBoundary('parenthesized literal payload', primitiveSource('').replace("{ kind: 'changed' }", "({ kind: ('changed') })"), ['false', 'true']),
  originBoundary('literal payload at depth boundary', primitiveSource('').replace("{ kind: 'changed' }", "{ a: { b: { c: { d: { value: 'changed' } } } } }"), 'unknown'),
  originBoundary('own primitive read beside literal helper', primitiveSource('read() { return this.label; }'), ['false', 'true'], 'instance.read();'),
  originBoundary('literal receiver member beside literal helper', primitiveSource("read() { return ('ready').length; }"), 'unknown', 'instance.read();'),
  originBoundary('dynamic own array read beside literal helper', primitiveSource('read(index: number) { return this.tags[index]; }'), 'unknown', 'instance.read(0);'),
  originBoundary('bounded own nested data read', primitiveSource("private data = { a: { value: 'ready' } }; read() { return this.data.a.value; }"), ['false', 'true'], 'instance.read();'),
  originBoundary('own nested data beyond path bound', primitiveSource("private data = { a: { b: { c: { d: { e: { value: 'ready' } } } } } }; read() { return this.data.a.b.c.d.e.value; }"), 'unknown', 'instance.read();'),
  originBoundary('zero argument sibling invocation', primitiveSource('private idle() {} visit() { this.idle(); }'), ['false', 'true'], 'instance.visit();'),
  originBoundary('async sibling invocation', primitiveSource('private async idle() {} visit() { this.idle(); }'), 'unknown', 'instance.visit();'),
  originBoundary('project push method beside literal helper', primitiveSource("private output = { push(_value: string) {} }; append() { this.output.push('ready'); }"), 'unknown', 'instance.append();'),
  originBoundary('mixed primitive array append', primitiveSource("append() { this.tags.push('ready'); }").replace('tags: string[]', 'tags: (string | number)[]'), 'unknown', 'instance.append();'),
  originBoundary('computed primitive append argument', primitiveSource("append() { this.tags.push('ready' + 'now'); }"), 'unknown', 'instance.append();'),
  originBoundary('literal typed append parameter', primitiveSource("append(value: 'ready') { this.tags.push(value); }"), 'unknown', "instance.append('ready');"),
];

const boundedDispatchFixtures: readonly Fixture[] = [
  ...[1, 6].map((depth): Fixture => {
    const parameters = Array.from({ length: depth }, (_, index) => `T${index} extends ${index === depth - 1 ? 'Order' : `T${index + 1}`}`).join(', ');
    const text = `${order}\nfunction observe<${parameters}>(value: T0) { const alias = value; return alias.closed; }`;
    return { name: `nominal parameter constraint depth ${depth}`, text, runtime: text, expected: depth === 1 ? ['false', 'true'] : 'unknown', guarded: 'renamed' };
  }),
  ...[12, 270].map((width): Fixture => {
    const type = `${Array.from({ length: width }, (_, index) => `{ readonly tag${index}?: number }`).join(' & ')} & Order`;
    return { name: `nominal intersection width ${width}`, text: `${order}\ntype Branded = ${type}; declare const target: Branded; const alias = target; alias.closed;`, runtime: `${order}\ntype Branded = ${type}; const target: Branded = instance; const alias = target; alias.closed;`, expected: width === 12 ? ['false', 'true'] : 'unknown', guarded: 'renamed' };
  }),
  ...[2, 6].map((depth): Fixture => {
    const nested = `${'() => '.repeat(depth)}Order`;
    const type = `(() => Order) | (${nested})`;
    return { name: `factory union alias depth ${depth}`, text: `${order}\ndeclare const make: ${type}; const alias = make;`, runtime: `${order}\nconst make: ${type} = () => instance; const alias = make;`, expected: depth === 2 ? ['false', 'true'] : 'unknown', guarded: 'renamed' };
  }),
  ...[2, 6].map((depth): Fixture => {
    const nested = `${'() => '.repeat(depth)}Order`;
    const type = `(() => Order) | (${nested})`;
    return { name: `selected factory union result depth ${depth}`, text: `${order}\ndeclare const make: ${type}; make().toString();`, runtime: `${order}\nconst make: ${type} = () => instance; make().toString();`, expected: depth === 2 ? ['false', 'true'] : 'unknown', guarded: 'renamed' };
  }),
  {
    name: 'record intersection direct member invocation',
    text: `${order}\ndeclare const holder: { get(): Order } & { tag: string }; holder.get().rename();`,
    runtime: `${order}\nconst holder: { get(): Order } & { tag: string } = { get: () => instance, tag: 'ready' }; holder.get().rename();`,
    expected: ['false', 'true'], guarded: 'renamed',
  },
  {
    name: 'record intersection alias remains conservative',
    text: `${order}\ndeclare const holder: { get(): Order } & { tag: string }; const alias = holder; alias.get().rename();`,
    runtime: `${order}\nconst holder: { get(): Order } & { tag: string } = { get: () => instance, tag: 'ready' }; const alias = holder; alias.get().rename();`,
    expected: 'unknown', guarded: 'renamed',
  },
  ...[false, true].map((alias): Fixture => {
    const text = `${order}\nfunction observe<T extends { get(): Order }>(holder: T) { ${alias ? 'const selected = holder;' : ''} ${alias ? 'selected' : 'holder'}.get().rename(); }`;
    return { name: `constrained record ${alias ? 'alias' : 'direct member'}`, text, runtime: text, expected: alias ? 'unknown' : ['false', 'true'], guarded: 'renamed' };
  }),
  {
    name: 'returned receiver factory array length',
    text: `${order}\ndeclare function make(): Array<() => Order>; make().length;`,
    runtime: `${order}\nfunction make(): Array<() => Order> { return [() => instance]; } make().length;`,
    expected: ['false', 'true'], guarded: 'renamed',
  },
  {
    name: 'returned receiver factory array opaque exposure',
    text: `${order}\ndeclare function make(): Array<() => Order>; declare function opaque(values: Array<() => Order>): void; opaque(make());`,
    runtime: `${order}\nfunction make(): Array<() => Order> { return [() => instance]; } function opaque(values: Array<() => Order>) { Object.defineProperty(values[0](), 'isClosed', { value: () => true }); } opaque(make());`,
    expected: 'unknown', guarded: '',
  },
];

const operationGraph = (shape: 'star' | 'namespace', exposed: boolean): Fixture => {
  const files: Record<string, string> = { '/native.ts': 'export const get = Object.getPrototypeOf;' };
  for (let index = 5; index >= 0; index--) files[`/layer${index}.ts`] = shape === 'star'
    ? `export * from './${index === 5 ? 'native' : `layer${index + 1}`}';`
    : `export * as next from './${index === 5 ? 'native' : `layer${index + 1}`}';`;
  const member = shape === 'star' ? 'ops.get' : `ops.${'next.'.repeat(6)}get`;
  return {
    name: `${shape} operation graph ${exposed ? 'opaque exposure' : 'selected primitive acquisition'}`,
    text: `import * as ops from './layer0';\n${order.replace('return false;', 'return [false].includes(this.closed);')}\n${exposed ? 'declare function opaque(value: object): void; opaque(ops);' : `${member}(1);`}`,
    extra: files,
    runtime: `${order.replace('return false;', 'return [false].includes(this.closed);')}\n${exposed ? "function opaque(get: typeof Object.getPrototypeOf) { get([]).includes = () => true; } opaque(Object.getPrototypeOf);" : 'Object.getPrototypeOf(1);'}`,
    expected: exposed ? 'unknown' : ['true'], guarded: exposed ? '' : 'renamed',
  };
};
const prototypeBindingFixtures: readonly Fixture[] = [
  ...(['star', 'namespace'] as const).flatMap(shape => [operationGraph(shape, false), operationGraph(shape, true)]),
  ...[false, true].map((fallback): Fixture => {
    const text = `${order.replace('return false;', 'return [false].includes(this.closed);')}\nconst { getPrototypeOf: get ${fallback ? '= Object.getPrototypeOf' : ''} } = Object; get(1);`;
    return { name: `native operation destructuring ${fallback ? 'default' : 'required'}`, text, runtime: text, expected: fallback ? 'unknown' : ['true'], guarded: 'renamed' };
  }),
];

describe.each([...originBoundaryFixtures, ...boundedDispatchFixtures, ...prototypeBindingFixtures])('$name', fixture => {
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
