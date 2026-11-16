import { describe, expect, it } from 'vitest';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const order = (expression = 'false', extra = '', field = 'closed: boolean = false;', prefix = '') => `${prefix}
export class Order {
  ${field}
  label = '';
  isClosed() { return ${expression}; }
  rename(label: string) { if (this.isClosed()) return; this.label = label; }
  unguarded(label: string) { this.label = label; }
}
${extra}`;

type Fixture = { readonly name: string; readonly files: Readonly<Record<string, string>>; readonly terminal?: string };

const includesCases: readonly Fixture[] = [
  ['aliased defineProperty', 'const define = Object.defineProperty; define(Array.prototype, "includes", { value() { return true; } });'],
  ['aliased assign', 'const assign = Object.assign; assign(Array.prototype, { includes() { return true; } });'],
  ['opaque Array prototype', 'declare function patch(target: object): void; patch(Array.prototype);'],
].map(([name, extra]) => ({ name: name!, files: { '/order.ts': order('[false].includes(this.closed)', extra) } }));

const erasedCases: readonly Fixture[] = [
  ['object erasure', 'object'],
  ['structural erasure', '{ isClosed(): boolean }'],
].map(([name, type]) => ({ name: name!, files: { '/order.ts': order('false', `
  declare function opaque(payload: { target: ${type} }): void;
  export const instance = new Order();
  const erased: ${type} = instance;
  opaque({ target: erased });
`) } }));

const classNamespace = (shape: 'direct' | 'star'): Fixture => ({
  name: `class namespace ${shape}`,
  files: {
    '/order.ts': order(),
    ...(shape === 'star' ? { '/barrel.ts': "export * from './order';" } : {}),
    '/hazard.ts': `import * as domain from './${shape === 'direct' ? 'order' : 'barrel'}'; declare function opaque(value: unknown): void; opaque(domain);`,
  },
});

const enumNamespace = (shape: 'direct' | 'star' | 'nested'): Fixture => ({
  name: `enum namespace ${shape}`,
  terminal: 'closed',
  files: {
    '/state.ts': "export enum State { Open = 'open', Closed = 'closed' }",
    '/order.ts': order('this.closed === State.Open', '', "closed: 'open' | 'closed' = 'open';", "import { State } from './state';"),
    ...(shape !== 'direct' ? { '/barrel.ts': shape === 'star' ? "export * from './state';" : "export * as inner from './state';" } : {}),
    '/hazard.ts': `import * as domain from './${shape === 'direct' ? 'state' : 'barrel'}'; declare function opaque(value: unknown): void; opaque(domain);`,
  },
});

const confirmedCases = [...includesCases, ...erasedCases, classNamespace('direct'), classNamespace('star'), enumNamespace('direct'), enumNamespace('star'), enumNamespace('nested')];

const sample = (fixture: Fixture) => {
  const project = inMemoryProject(fixture.files);
  const cls = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  const model = extractLifecycles({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'closed', terminal: [fixture.terminal ?? 'true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: project.getSourceFiles(), projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates.find(aggregate => aggregate.name === 'Order')!;
  return { project, model, aggregate };
};

const sources = (fixture: Fixture) => {
  const { aggregate } = sample(fixture);
  return describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources);
};

const findings = (fixture: Fixture) => terminalStateLeak(sample(fixture).aggregate).map(finding => finding.details.method);

describe('runtime dependencies behind scalar predicates', () => {
  it.each(confirmedCases)('has diagnostic-free source for $name', fixture => {
    const { project } = sample(fixture);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(confirmedCases)('rejects the unproved guard for $name', fixture => {
    const actual = sources(fixture);

    expect(actual).toBe('unknown');
  });

  it.each(confirmedCases)('retains only the unguarded finding for $name', fixture => {
    const actual = findings(fixture);

    expect(actual).toEqual(['unguarded']);
  });
});

const boundaryCases = [
  ['aliased reflective mutation', 'const define = Object.defineProperty; define({ value: 1 }, "value", { value: 2 });', 'unknown'],
  ['aliased reflective assign', 'const assign = Object.assign; assign({ value: 1 }, { value: 2 });', 'unknown'],
  ['user mutator name', 'const Object = { defineProperty(_target: object, _key: string, _descriptor: object) { return true; } }; Object.defineProperty({ value: 1 }, "value", { value: 2 });', ['false']],
  ['unused object erasure', 'const instance = new Order(); const erased: object = instance;', 'unknown'],
  ['unused structural erasure', 'const instance = new Order(); const erased: { isClosed(): boolean } = instance;', 'unknown'],
  ['asserted erasure', 'const instance = new Order(); const erased = instance as object;', 'unknown'],
  ['restored assertion', 'const instance = new Order(); const erased = (instance as object) as Order;', 'unknown'],
  ['structural storage', 'const instance = new Order(); const holder: { target: object } = { target: instance };', 'unknown'],
  ['erased return', 'function create(): object { return new Order(); }', 'unknown'],
  ['structural return', 'function create(): { isClosed(): boolean } { return new Order(); }', 'unknown'],
  ['nominal inferred alias', 'const instance = new Order(); const alias = instance; alias.rename("x");', ['false']],
  ['nominal explicit alias', 'const instance = new Order(); const alias: Order = instance; alias.rename("x");', ['false']],
  ['nominal inferred return', 'function create() { return new Order(); } const instance = create(); instance.rename("x");', ['false']],
  ['nominal explicit return', 'function create(): Order { return new Order(); } const instance = create(); instance.rename("x");', ['false']],
  ['nominal arrow return', 'const create = (): Order => new Order(); const instance = create(); instance.rename("x");', ['false']],
  ['ordinary constructed call', 'new Order().rename("x");', ['false']],
  ['unrelated payload', 'declare function record(value: { target: { value: number } }): void; record({ target: { value: 1 } });', ['false']],
] as const;

const boundaryFixture = (extra: string): Fixture => ({ name: extra, files: { '/order.ts': order('this.closed', extra) } });

describe('nominal receiver representation boundaries', () => {
  it.each(boundaryCases)('has diagnostic-free source for %s', (_name, extra) => {
    const { project } = sample(boundaryFixture(extra));

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(boundaryCases)('preserves identity for %s only when proven', (_name, extra, expected) => {
    const actual = sources(boundaryFixture(extra));

    expect(actual).toEqual(expected);
  });
});

const namespaceControls: readonly (Fixture & { readonly expected: readonly string[] | 'unknown' })[] = [
  { name: 'disjoint class namespace', files: { '/order.ts': order('this.closed'), '/other.ts': 'export class Other {}', '/hazard.ts': "import * as values from './other'; declare function opaque(value: unknown): void; opaque(values);" }, expected: ['false'] },
  { name: 'unrelated namespace', files: { '/order.ts': order('this.closed'), '/other.ts': 'export const harmless = 1;', '/hazard.ts': "import * as values from './other'; declare function opaque(value: unknown): void; opaque(values);" }, expected: ['false'] },
  { name: 'unrelated selected export', files: { '/order.ts': order('this.closed'), '/barrel.ts': "export * from './order'; export const harmless = 1;", '/hazard.ts': "import * as values from './barrel'; declare function opaque(value: unknown): void; opaque(values.harmless);" }, expected: ['false'] },
  { name: 'renamed nominal construction', files: { '/order.ts': order('this.closed'), '/barrel.ts': "export { Order as Renamed } from './order';", '/hazard.ts': "import * as values from './barrel'; const instance = new values.Renamed(); instance.rename('x');" }, expected: ['false'] },
  { name: 'nested selected enum', terminal: 'closed', files: { '/state.ts': "export enum State { Open = 'open', Closed = 'closed' }", '/barrel.ts': "export * as inner from './state';", '/order.ts': order('this.closed === values.inner.State.Open', '', "closed: 'open' | 'closed' = 'open';", "import * as values from './barrel';") }, expected: ['closed'] },
  { name: 'unrelated export cycle', files: { '/order.ts': order('this.closed'), '/first.ts': "export * as loop from './second';", '/second.ts': "export * as loop from './first';", '/hazard.ts': "import * as values from './first'; declare function opaque(value: unknown): void; opaque(values);" }, expected: ['false'] },
  { name: 'reachable class beside export cycle', files: { '/order.ts': order('this.closed'), '/first.ts': "export * as loop from './second'; export { Order as Renamed } from './order';", '/second.ts': "export * as loop from './first';", '/hazard.ts': "import * as values from './first'; declare function opaque(value: unknown): void; opaque(values);" }, expected: 'unknown' },
  { name: 'export graph exhaustion', files: { '/order.ts': order('this.closed'), '/other.ts': Array.from({ length: 300 }, (_, index) => `export const value${index} = ${index};`).join('\n'), '/hazard.ts': "import * as values from './other'; declare function opaque(value: unknown): void; opaque(values);" }, expected: 'unknown' },
];

describe('selected namespace uses and dependency graphs', () => {
  it.each(namespaceControls)('uses diagnostic-free source for $name', fixture => {
    const { project } = sample(fixture);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(namespaceControls)('preserves the intended result for $name', fixture => {
    const actual = sources(fixture);

    expect(actual).toEqual(fixture.expected);
  });
});

const arrayCases = [
  ['augmented reflective overload', 'declare global { interface ObjectConstructor { getPrototypeOf(value: unknown): { includes(value: boolean): boolean }; } } const get = Object.getPrototypeOf; const prototype = get([]); declare function patch(payload: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['stored prototype', 'const prototype = Array.prototype;', 'unknown'],
  ['constructor alias', 'const A = Array;', 'unknown'],
  ['qualified prototype', 'declare function patch(value: object): void; patch(globalThis.Array.prototype);', 'unknown'],
  ['nested prototype', 'declare function patch(value: { target: object }): void; patch({ target: Array.prototype });', 'unknown'],
  ['Object prototype acquisition alias', 'const get = Object.getPrototypeOf; const prototype = get([]);', 'unknown'],
  ['Reflect prototype acquisition alias', 'const get = Reflect.getPrototypeOf; const prototype = get([]);', 'unknown'],
  ['unknown prototype acquisition', 'declare const value: object; const get = Object.getPrototypeOf; const prototype = get(value);', 'unknown'],
  ['legacy array prototype', 'const values: unknown[] = []; const prototype = (values as unknown as { __proto__: object }).__proto__;', 'unknown'],
  ['legacy unknown prototype', 'declare const value: { __proto__: object }; const prototype = value.__proto__;', 'unknown'],
  ['primitive prototype acquisition', 'const get = Object.getPrototypeOf; const prototype = get(1);', ['true']],
  ['ordinary includes', '', ['true']],
  ['unrelated payload', 'declare function record(value: { target: { value: number } }): void; record({ target: { value: 1 } });', ['true']],
  ['shadowed Array', 'class Array {} declare function record(value: object): void; record(Array.prototype);', ['true']],
  ['shadowed Object mutator', 'const Object = { assign(_value: object) { return true; } }; Object.assign({ value: 1 });', ['true']],
  ['shadowed Reflect acquisition', 'const Reflect = { getPrototypeOf(_value: object) { return {}; } }; Reflect.getPrototypeOf({ value: 1 });', ['true']],
] as const;

const arrayFixture = (extra: string): Fixture => ({ name: extra, files: { '/order.ts': order('[false].includes(this.closed)', extra) } });

describe('literal-array runtime dependency identity', () => {
  it.each(arrayCases)('has diagnostic-free source for %s', (_name, extra) => {
    const { project } = sample(arrayFixture(extra));

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(arrayCases)('checks the dependency for %s', (_name, extra, expected) => {
    const actual = sources(arrayFixture(extra));

    expect(actual).toEqual(expected);
  });

  it('keeps primitive predicates precise beside an opaque Array prototype exposure', () => {
    const fixture = boundaryFixture('declare function patch(value: object): void; patch(Array.prototype);');
    const actual = sources(fixture);

    expect(actual).toEqual(['false']);
  });
});

const siblingPrototype: Fixture = { name: 'sibling prototype with shared base', files: { '/order.ts': `
class Base { closed: boolean = false; isClosed() { return false; } }
export class Order extends Base {
  label = '';
  rename(label: string) { if (this.isClosed()) return; this.label = label; }
  unguarded(label: string) { this.label = label; }
}
class Other extends Base {}
declare function opaque(target: object): void;
opaque(Other.prototype);
` } };

const exportControls: readonly (Fixture & { readonly expected: readonly string[] | 'unknown' })[] = [
  { name: 'default class export', files: { '/order.ts': order('this.closed', 'export default Order;') }, expected: ['false'] },
  { name: 'default enum export', terminal: 'closed', files: { '/state.ts': "export enum State { Open = 'open', Closed = 'closed' } export default State;", '/order.ts': order('this.closed === State.Open', '', "closed: 'open' | 'closed' = 'open';", "import State from './state';") }, expected: ['closed'] },
  { name: 'default namespace exposure', files: { '/order.ts': order('this.closed'), '/barrel.ts': "import * as domain from './order'; export default domain;", '/hazard.ts': "import domain from './barrel'; declare function opaque(value: unknown): void; opaque(domain);" }, expected: 'unknown' },
  { ...siblingPrototype, expected: 'unknown' },
  { name: 'sibling decorator', files: { '/order.ts': siblingPrototype.files['/order.ts']!.replace('class Other extends Base {}\ndeclare function opaque(target: object): void;\nopaque(Other.prototype);', 'declare function decorate<T extends abstract new (...args: never[]) => object>(target: T, context: ClassDecoratorContext): T;\n@decorate class Other extends Base {}') }, expected: 'unknown' },
  { name: 'disjoint decorator', files: { '/order.ts': order('this.closed', 'declare function decorate<T extends abstract new (...args: never[]) => object>(target: T, context: ClassDecoratorContext): T; @decorate class Other {}') }, expected: ['false'] },
  { name: 'erased sibling prototype', files: { '/order.ts': siblingPrototype.files['/order.ts']!.replace('opaque(Other.prototype);', 'const erased: object = Other.prototype; opaque({ target: erased });') }, expected: 'unknown' },
];

describe('export bindings and shared prototype identity', () => {
  it.each(exportControls)('uses diagnostic-free source for $name', fixture => {
    const { project } = sample(fixture);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(exportControls)('checks $name', fixture => {
    const actual = sources(fixture);

    expect(actual).toEqual(fixture.expected);
  });
});

const factoryCases = [
  ['captured factory shorthand payload', 'const instance = new Order(); const factory = () => instance; declare function opaque(payload: { factory: () => Order }): void; opaque({ factory });', 'unknown'],
  ['named factory explicit payload', 'const instance = new Order(); function make() { return instance; } declare function opaque(payload: { factory: () => Order }): void; opaque({ factory: make });', 'unknown'],
  ['direct callback argument', 'function make() { return new Order(); } declare function opaque(callback: () => Order): void; opaque(make);', 'unknown'],
  ['aliased factory nested payload', 'const instance = new Order(); const make = () => instance; const alias = make; declare function opaque(payload: { nested: { factory: () => Order } }): void; opaque({ nested: { factory: alias } });', 'unknown'],
  ['unused erased callable return', 'const make = () => new Order(); const erased: () => object = make;', 'unknown'],
  ['unused Function erasure', 'const make = () => new Order(); const erased: Function = make;', 'unknown'],
  ['unused object erasure of callable', 'const make = () => new Order(); const erased: object = make;', 'unknown'],
  ['unused unknown erasure of callable', 'const make = () => new Order(); const erased: unknown = make;', 'unknown'],
  ['restored callable assertion', 'const make = () => new Order(); const erased = (make as () => object) as () => Order;', 'unknown'],
  ['structural callable storage', 'const make = () => new Order(); const holder: { factory: () => object } = { factory: make };', 'unknown'],
  ['factory array payload', 'const make = () => new Order(); declare function opaque(values: (() => Order)[]): void; opaque([make]);', 'unknown'],
  ['factory spread payload', 'declare const holder: { factory: () => Order }; declare function opaque(value: object): void; opaque({ ...holder });', 'unknown'],
  ['factory constructor argument', 'const make = () => new Order(); declare class Consumer { constructor(make: () => Order); } new Consumer(make);', 'unknown'],
  ['higher order opaque escape', 'const instance = new Order(); const outer = () => () => instance; declare function opaque(make: () => () => Order): void; opaque(outer);', 'unknown'],
  ['higher order erased return', 'const make = () => new Order(); function outer(): () => object { return make; }', 'unknown'],
  ['holder opaque escape', 'declare const holder: { make(): Order }; declare function opaque(value: object): void; opaque(holder);', 'unknown'],
  ['object method storage', 'const instance = new Order(); const holder = { make() { return instance; } }; declare function opaque(value: object): void; opaque(holder);', 'unknown'],
  ['cyclic callable graph', 'interface Recursive { (): Recursive; make(): Order } declare const make: Recursive; declare function opaque(value: unknown): void; opaque(make);', 'unknown'],
  ['depth exhausted callable graph', 'declare const make: () => () => () => () => () => () => Order; declare function opaque(value: unknown): void; opaque(make);', 'unknown'],
  ['work exhausted holder graph', `declare const holder: { ${Array.from({ length: 260 }, (_, index) => `value${index}: number;`).join(' ')} }; declare function opaque(value: object): void; opaque(holder);`, 'unknown'],
  ['readonly array holder escape', 'declare const holder: ReadonlyArray<() => Order>; declare function opaque(value: unknown): void; opaque(holder);', 'unknown'],
  ['tuple holder escape', 'declare const holder: readonly [() => Order]; declare function opaque(value: unknown): void; opaque(holder);', 'unknown'],
  ['indexed holder escape', 'declare const holder: { [name: string]: () => Order }; declare function opaque(value: unknown): void; opaque(holder);', 'unknown'],
  ['mapped Record holder escape', 'declare const holder: Record<"make", () => Order>; declare function opaque(value: unknown): void; opaque(holder);', 'unknown'],
  ['mapped Readonly holder escape', 'declare const holder: Readonly<{ make(): Order }>; declare function opaque(value: unknown): void; opaque(holder);', 'unknown'],
  ['union callable escape', 'declare const make: (() => number) | (() => Order); declare function opaque(value: unknown): void; opaque(make);', 'unknown'],
  ['overloaded callable escape', 'declare function make(value: string): number; declare function make(value: number): Order; declare function opaque(value: unknown): void; opaque(make);', 'unknown'],
  ['nominal type alias direct call', 'type Nominal = Order; declare const make: () => Nominal; const alias = make; alias().rename("x");', ['false']],
  ['nominal intersection callable opaque escape', 'type Branded = Order & { readonly tag?: "x" }; declare const make: () => Branded; const alias = make; declare function opaque(value: unknown): void; opaque({ factory: alias });', 'unknown'],
  ['nominal union erased callable alias', 'declare const make: () => Order; const alias: (() => Order) | (() => object) = make; declare function opaque(value: unknown): void; opaque(alias);', 'unknown'],
  ['nominal intersection callable alias', 'type Branded = Order & { readonly tag?: "x" }; declare const make: () => Branded; const alias = make; alias().rename("x");', ['false']],
  ['mapped holder direct call', 'declare const holder: Readonly<{ make(): Order }>; holder.make().rename("x");', ['false']],
  ['callable intersection erased return escape', 'const instance = new Order(); const make = () => instance; const alias = make as (() => object) & (() => Order); const erased = alias(); declare function opaque(payload: { target: object }): void; opaque({ target: erased });', 'unknown'],
  ['cyclic holder factory return escape', 'interface Holder { factory(): Holder; target: Order } declare const holder: Holder; declare function opaque(value: Holder): void; opaque(holder);', 'unknown'],
  ['callable intersection nominal overloads', 'declare const make: (() => Order) & ((value: string) => Order); const alias = make; alias().rename("x");', ['false']],
  ['callable constructor capability escape', 'interface Both { new(): object; (): Order } declare const make: Both; declare function opaque(value: Both): void; opaque(make);', 'unknown'],
  ['unrelated callable constructor payload', 'interface Both { new(): object; (): number } declare const make: Both; declare function opaque(value: Both): void; opaque(make);', ['false']],
  ['unused captured factory', 'const instance = new Order(); const make = () => instance;', ['false']],
  ['inferred factory direct call', 'const make = () => new Order(); const instance = make(); instance.rename("x");', ['false']],
  ['explicit factory direct call', 'function make(): Order { return new Order(); } const instance = make(); instance.rename("x");', ['false']],
  ['captured factory direct call', 'const instance = new Order(); const make = () => instance; make().rename("x");', ['false']],
  ['nominal callable alias direct call', 'const instance = new Order(); const make = () => instance; const alias: () => Order = make; alias().rename("x");', ['false']],
  ['static nominal factory direct call', 'class Factory { static make(): Order { return new Order(); } } Factory.make().rename("x");', ['false']],
  ['declared holder direct call', 'declare const holder: { make(): Order }; holder.make().rename("x");', ['false']],
  ['higher order direct call', 'const instance = new Order(); const outer = () => () => instance; const make = outer(); make().rename("x");', ['false']],
  ['unrelated event beside factory call', 'const make = () => new Order(); const instance = make(); instance.rename("x"); declare function record(value: { event: string }): void; record({ event: "renamed" });', ['false']],
  ['primitive callback payload', 'declare function opaque(value: { factory: () => number }): void; const make = () => 1; opaque({ factory: make });', ['false']],
  ['unrelated nominal callback payload', 'class Other { value = 1; } declare function opaque(value: { factory: () => Other }): void; const make = () => new Other(); opaque({ factory: make });', ['false']],
  ['unrelated unknown callback payload', 'declare const make: () => unknown; declare function opaque(value: { factory: () => unknown }): void; opaque({ factory: make });', ['false']],
] as const;

const factoryFixture = (extra: string, expression = 'this.closed'): Fixture => ({ name: extra, files: { '/order.ts': order(expression, extra) } });

describe('visible receiver factory capabilities', () => {
  it.each(factoryCases)('has diagnostic-free source for %s', (_name, extra) => {
    const { project } = sample(factoryFixture(extra));

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(factoryCases)('keeps the intended guard sources for %s', (_name, extra, expected) => {
    const actual = sources(factoryFixture(extra, expected === 'unknown' ? 'false' : 'this.closed'));

    expect(actual).toEqual(expected);
  });

  it.each(factoryCases)('keeps the unguarded finding for %s', (_name, extra, expected) => {
    const actual = findings(factoryFixture(extra, expected === 'unknown' ? 'false' : 'this.closed'));

    expect(actual).toEqual(['unguarded']);
  });
});

const declaredFactoryHolder: Fixture = {
  name: 'project declaration holder escape',
  files: {
    '/order.ts': order(),
    '/holder.d.ts': "import { Order } from './order'; export interface Holder { make(): Order } export declare const holder: Holder;",
    '/hazard.ts': "import { holder } from './holder'; declare function opaque(value: unknown): void; opaque(holder);",
  },
};

describe('factory holders declared outside runtime sources', () => {
  it('has diagnostic-free holder declarations', () => {
    const { project } = sample(declaredFactoryHolder);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it('declines the exposed declared holder guard', () => {
    const actual = sources(declaredFactoryHolder);

    expect(actual).toEqual('unknown');
  });

  it('retains the unguarded finding beside a declared holder', () => {
    const actual = findings(declaredFactoryHolder);

    expect(actual).toEqual(['unguarded']);
  });
});

const residualOperationCases = [
  ['typed Object prototype acquisition', 'const get: (value: object) => { includes(value: boolean): boolean } = Object.getPrototypeOf; const prototype = get([]); declare function patch(payload: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['typed Reflect prototype acquisition', 'const get: (value: object) => object | null = Reflect.getPrototypeOf; const prototype = get([]) as { includes(value: boolean): boolean }; declare function patch(payload: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['prototype operation call receiver', 'const prototype = Object.getPrototypeOf.call(Object, []); declare function patch(payload: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['prototype operation Reflect apply', 'const prototype = Reflect.apply(Object.getPrototypeOf, Object, [[]]); declare function patch(payload: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['typed Object namespace erasure', 'const ops: { getPrototypeOf(value: object): { includes(value: boolean): boolean } } = Object; const prototype = ops.getPrototypeOf([]); declare function patch(value: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['typed Reflect namespace erasure', 'const ops: { getPrototypeOf(value: object): object | null } = Reflect; const prototype = ops.getPrototypeOf([]) as { includes(value: boolean): boolean }; declare function patch(value: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['asserted namespace erasure', 'const ops = Object as { getPrototypeOf(value: object): object }; const prototype = ops.getPrototypeOf([]) as { includes(value: boolean): boolean }; declare function patch(value: { target: { includes(value: boolean): boolean } }): void; patch({ target: prototype });', 'unknown'],
  ['returned prototype operation', 'function operation() { return Object.getPrototypeOf; }', 'unknown'],
  ['stored prototype operation', 'const holder = { get: Object.getPrototypeOf };', 'unknown'],
  ['inferred namespace primitive acquisition', 'const ops = Object; const prototype = ops.getPrototypeOf(1);', ['true']],
  ['qualified primitive acquisition', 'const prototype = globalThis.Object.getPrototypeOf(1);', ['true']],
  ['ordinary Object boxing', 'const value = Object(1);', ['true']],
  ['ordinary Object construction', 'const value = new Object();', ['true']],
  ['element primitive acquisition', 'const prototype = Object["getPrototypeOf"](1);', ['true']],
  ['inferred primitive operation alias', 'const get = Object.getPrototypeOf; const prototype = get(1);', ['true']],
  ['destructured primitive operation alias', 'const { getPrototypeOf: get } = Object; const prototype = get(1);', ['true']],
  ['explicit preserved operation identity', 'const get: typeof Object.getPrototypeOf = Object.getPrototypeOf; const prototype = get(1);', ['true']],
  ['inferred Reflect primitive alias', 'const get = Reflect.getPrototypeOf; const prototype = get(Object(1));', 'unknown'],
] as const;

const residualFactoryCases = [
  ['constructor static method escape', 'const instance = new Order(); class Factory { constructor() { throw new Error("must not construct"); } static make(): Order { return instance; } } declare function opaque(value: typeof Factory): void; opaque(Factory);', 'unknown'],
  ['constructible static holder escape', 'const instance = new Order(); class Factory { static make(): Order { return instance; } } const holder: { new(): object; make(): Order } = Factory; declare function opaque(value: typeof holder): void; opaque(holder);', 'unknown'],
  ['inferred constructor alias direct static factory', 'class Factory { static make(): Order { return new Order(); } } const Alias = Factory; Alias.make().rename("x");', ['false']],
  ['direct constructed factory member', 'class Factory { make(): Order { return new Order(); } } new Factory().make().rename("x");', ['false']],
  ['direct static factory call', 'class Factory { static make(): Order { return new Order(); } } Factory.make().rename("x");', ['false']],
  ['unrelated constructor payload', 'class Factory {} declare function opaque(value: typeof Factory): void; opaque(Factory);', ['false']],
  ['primitive static factory payload', 'class Factory { static make() { return 1; } } declare function opaque(value: typeof Factory): void; opaque(Factory);', ['false']],
  ['unrelated static factory payload', 'class Other { value = 1; } class Factory { static make() { return new Other(); } } declare function opaque(value: typeof Factory): void; opaque(Factory);', ['false']],
] as const;

const residualCases = [
  ...residualOperationCases.map(([name, extra, expected]) => ({ name, fixture: arrayFixture(extra), expected, expectedFindings: expected === 'unknown' ? ['unguarded'] : ['rename', 'unguarded'] })),
  ...residualFactoryCases.map(([name, extra, expected]) => ({ name, fixture: factoryFixture(extra, expected === 'unknown' ? 'false' : 'this.closed'), expected, expectedFindings: ['unguarded'] })),
];

describe('operation values and static factory exposure boundaries', () => {
  it.each(residualCases)('has diagnostic-free source for $name', ({ fixture }) => {
    const { project } = sample(fixture);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(residualCases)('keeps the intended guard sources for $name', ({ fixture, expected }) => {
    const actual = sources(fixture);

    expect(actual).toEqual(expected);
  });

  it.each(residualCases)('retains the intended findings for $name', ({ fixture, expectedFindings }) => {
    const actual = findings(fixture);

    expect(actual).toEqual(expectedFindings);
  });
});

it('keeps primitive predicates precise beside erased prototype operations', () => {
  const fixture: Fixture = { name: 'primitive predicate with erased operation', files: { '/order.ts': order('this.closed', 'const get: (value: object) => object = Object.getPrototypeOf; const prototype = get([]);') } };

  const actual = sources(fixture);

  expect(actual).toEqual(['false']);
});

const operationModuleCases: readonly (Fixture & { readonly expected: readonly string[] | 'unknown' })[] = [
  ...[
    ['operation', 'export const get = Object.getPrototypeOf;', '{ get(value: object): unknown }'],
    ['Object namespace', 'export const native = Object;', '{ native: ObjectConstructor }'],
    ['Reflect namespace', 'export const native = Reflect;', '{ native: typeof Reflect }'],
  ].map(([name, declaration, type]) => ({ name: `${name} module exposure`, files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': declaration!, '/consumer.ts': `import * as ops from './ops'; declare function opaque(value: ${type}): void; opaque(ops);` }, expected: 'unknown' as const })),
  { name: 'selected operation primitive call', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/consumer.ts': "import * as ops from './ops'; const prototype = ops.get(1);" }, expected: ['true'] },
  { name: 'selected native primitive call', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const native = Object;', '/consumer.ts': "import * as ops from './ops'; const prototype = ops.native.getPrototypeOf(1);" }, expected: ['true'] },
  { name: 'unrelated module payload', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const value = 1;', '/consumer.ts': "import * as ops from './ops'; declare function opaque(value: object): void; opaque(ops);" }, expected: ['true'] },
];

const selectedOverloadCases = [
  ['mixed dual constructor local alias', 'const instance = new Order(); declare const make: { new(): object; (): object; (kind: string): Order }; const alias = make; const target = alias(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['declared mixed overload direct call', 'const instance = new Order(); declare const make: { new(): object; (): object; (kind: string): Order }; const target = make(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['implemented mixed overload direct call', 'const instance = new Order(); function make(): object; function make(kind: string): Order; function make(kind?: string): Order { return instance; } const target = make(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['implemented mixed static overload call', 'const instance = new Order(); class Factory { static make(): object; static make(kind: string): Order; static make(kind?: string): Order { return instance; } } const target = Factory.make(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['all nominal dual local direct call', 'declare const make: { new(): object; (): Order; (kind: string): Order }; const alias = make; alias().rename("x");', ['false']],
  ['all nominal ordinary overload call', 'const instance = new Order(); function make(): Order; function make(kind: string): Order; function make(kind?: string): Order { return instance; } make().rename("x");', ['false']],
  ['mixed overload selects nominal result', 'declare function make(): object; declare function make(kind: string): Order; make("nominal").rename("x");', ['false']],
  ['mixed overload selects primitive result', 'declare function make(): number; declare function make(kind: string): Order; const value = make();', ['false']],
  ['instantiated generic nominal result', 'declare function make<T extends Order>(): T; make<Order>().rename("x");', ['false']],
  ['instantiated generic erased result', 'declare function make<T>(): T; declare function make(kind: string): Order; const target = make<object>(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['dual construction erased result', 'declare const make: { new(): object; (): Order }; const target = new make(); declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['primitive union selected overload', 'declare function make(): number | string; declare function make(kind: string): Order; const value = make();', ['false']],
  ['nominal dual construction result', 'declare const make: { new(): Order; (): Order }; new make().rename("x");', ['false']],
  ['selected void erases a runtime receiver', 'const instance = new Order(); function make(): void; function make(kind: string): Order; function make(kind?: string): Order { return instance; } const target = make(); declare function opaque(payload: { target: unknown }): void; opaque({ target });', 'unknown'],
  ['selected never representation unproved', 'declare function make(): never; declare function make(kind: string): Order; const target = make(); declare function opaque(payload: { target: unknown }): void; opaque({ target });', 'unknown'],
  ['returned container with primitive sibling', 'declare function make(): { get(): Order; tag: string }; make().get().rename("x");', ['false']],
  ['returned container with erased sibling', 'declare function make(): { get(): Order; hidden: object }; const target = make().hidden; declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['callable container erased member', 'declare function make(): (() => number) & { get(): Order; hidden: object }; const target = make().hidden; declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['container structural member erasure', 'declare function make(): { get(): Order; hidden: { closed: boolean } }; const target = make().hidden; declare function opaque(payload: { target: object }): void; opaque({ target });', 'unknown'],
  ['returned callable direct use', 'declare function make(): () => Order; make()().rename("x");', ['false']],
  ['returned container direct use', 'declare function make(): { get(): Order }; make().get().rename("x");', ['false']],
] as const;

const operationGraphCases: readonly (Fixture & { readonly expected: readonly string[] | 'unknown' })[] = [
  { name: 'renamed operation export', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/barrel.ts': "export { get as obtain } from './ops';", '/consumer.ts': "import * as ops from './barrel'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'star operation export', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/barrel.ts': "export * from './ops';", '/consumer.ts': "import * as ops from './barrel'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'nested operation export', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/barrel.ts': "export * as inner from './ops';", '/consumer.ts': "import * as ops from './barrel'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'operation beside export cycle', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/first.ts': "export * as loop from './second'; export { get } from './ops';", '/second.ts': "export * as loop from './first';", '/consumer.ts': "import * as ops from './first'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'unrelated operation-free export cycle', files: { '/order.ts': order('[false].includes(this.closed)'), '/first.ts': "export * as loop from './second';", '/second.ts': "export * as loop from './first';", '/consumer.ts': "import * as ops from './first'; declare function opaque(value: object): void; opaque(ops);" }, expected: ['true'] },
  { name: 'operation export budget exhaustion', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': Array.from({ length: 260 }, (_, index) => `export const item${index} = ${index};`).join('\n'), '/consumer.ts': "import * as ops from './ops'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'type-only operation reexport', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/types.ts': "export type { get } from './ops'; export const harmless = 1;", '/consumer.ts': "import * as ops from './types'; declare function opaque(value: object): void; opaque(ops);" }, expected: ['true'] },
  { name: 'type-only operation export', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export type Operation = typeof Object.getPrototypeOf; export const harmless = 1;', '/consumer.ts': "import * as ops from './ops'; declare function opaque(value: object): void; opaque(ops);" }, expected: ['true'] },
  { name: 'inferred module alias primitive call', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/consumer.ts': "import * as ops from './ops'; const alias = ops; alias.get(1);" }, expected: ['true'] },
  { name: 'rest module carrier escape', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/consumer.ts': "import * as ops from './ops'; const { ...alias } = ops; declare function opaque(value: object): void; opaque(alias);" }, expected: 'unknown' },
];

const fix5Cases = [
  ...[...operationModuleCases, ...operationGraphCases].map(fixture => ({ name: fixture.name, fixture, expected: fixture.expected, expectedFindings: fixture.expected === 'unknown' ? ['unguarded'] : ['rename', 'unguarded'] })),
  ...selectedOverloadCases.map(([name, extra, expected]) => ({ name, fixture: factoryFixture(extra, expected === 'unknown' ? 'false' : 'this.closed'), expected, expectedFindings: ['unguarded'] })),
];

describe('module capability and selected overload boundaries', () => {
  it.each(fix5Cases)('has diagnostic-free source for $name', ({ fixture }) => {
    const { project, model } = sample(fixture);

    expect({ diagnostics: project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText()), problems: model.problems }).toEqual({ diagnostics: [], problems: [] });
  });

  it.each(fix5Cases)('keeps the intended guard sources for $name', ({ fixture, expected }) => {
    const actual = sources(fixture);

    expect(actual).toEqual(expected);
  });

  it.each(fix5Cases)('retains the intended findings for $name', ({ fixture, expectedFindings }) => {
    const actual = findings(fixture);

    expect(actual).toEqual(expectedFindings);
  });
});

it('keeps primitive predicates precise beside an escaped operation module', () => {
  const fixture: Fixture = { name: 'primitive predicate operation module', files: { ...operationModuleCases[0]!.files, '/order.ts': order('this.closed') } };

  const actual = sources(fixture);

  expect(actual).toEqual(['false']);
});

const mixedRuntimePathCases: readonly (Fixture & { readonly expected: readonly string[] | 'unknown' })[] = [
  ...[
    ['type then value', "export * from './types'; export * from './ops';", "export const get = Object.getPrototypeOf;", "export type { get } from './ops';", 'unknown'],
    ['value then type', "export * from './ops'; export * from './types';", "export const get = Object.getPrototypeOf;", "export type { get } from './ops';", 'unknown'],
    ['type route only', "export * from './types';", "export const get = Object.getPrototypeOf;", "export type { get } from './ops';", 'precise'],
    ['renamed type then value', "export * from './types'; export { get as live } from './ops';", "export const get = Object.getPrototypeOf;", "export type { get as live } from './ops';", 'unknown'],
    ['Object type then value', "export * from './types'; export * from './ops';", 'export const native = Object;', "export type { native } from './ops';", 'unknown'],
    ['Reflect type then value', "export * from './types'; export * from './ops';", 'export const native = Reflect;', "export type { native } from './ops';", 'unknown'],
    ['unrelated same-name routes', "export * from './types'; export * from './ops';", 'export const harmless = 1;', "export type { harmless } from './ops';", 'precise'],
  ].map(([name, entry, ops, types, expected]) => ({ name: name!, files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': ops!, '/types.ts': types!, '/entry.ts': `${entry} export const marker = 1;`, '/consumer.ts': "import * as ops from './entry'; declare function opaque(value: object): void; opaque(ops);" }, expected: expected === 'unknown' ? 'unknown' as const : ['true'] })),
  { name: 'runtime value differs from type-only representative', files: { '/order.ts': order('[false].includes(this.closed)'), '/other.ts': 'export const get = (value: unknown) => value;', '/ops.ts': 'export const get = Object.getPrototypeOf;', '/types.ts': "export type { get } from './other';", '/entry.ts': "export * from './types'; export * from './ops'; export { get } from './ops'; export const marker = 1;", '/consumer.ts': "import * as ops from './entry'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'unrelated runtime value replaces protected type-only representative', files: { '/order.ts': order('[false].includes(this.closed)'), '/other.ts': 'export const get = Object.getPrototypeOf;', '/ops.ts': 'export const get = () => 1;', '/types.ts': "export type { get } from './other';", '/entry.ts': "export * from './types'; export * from './ops'; export { get } from './ops'; export const marker = 1;", '/consumer.ts': "import * as ops from './entry'; declare function opaque(value: object): void; opaque(ops);" }, expected: ['true'] },
  { name: 'nested mixed-route barrel', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/types.ts': "export type { get } from './ops';", '/bridge.ts': "export * from './types'; export * from './ops';", '/entry.ts': "export * as inner from './bridge'; export const marker = 1;", '/consumer.ts': "import * as ops from './entry'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
  { name: 'mixed-route primitive selection', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/types.ts': "export type { get } from './ops';", '/entry.ts': "export * from './ops'; export * from './types'; export const marker = 1;", '/consumer.ts': "import * as ops from './entry'; ops.get(1);" }, expected: ['true'] },
  { name: 'cycle beside runtime route', files: { '/order.ts': order('[false].includes(this.closed)'), '/ops.ts': 'export const get = Object.getPrototypeOf;', '/types.ts': "export type { get } from './ops';", '/cycle.ts': "export * from './entry'; export * from './ops';", '/entry.ts': "export * from './types'; export * from './cycle'; export const marker = 1;", '/consumer.ts': "import * as ops from './entry'; declare function opaque(value: object): void; opaque(ops);" }, expected: 'unknown' },
];

describe('all runtime paths for mixed type and value exports', () => {
  it.each(mixedRuntimePathCases)('has diagnostic-free source for $name', fixture => {
    const { project, model } = sample(fixture);

    expect({ diagnostics: project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText()), problems: model.problems }).toEqual({ diagnostics: [], problems: [] });
  });

  it.each(mixedRuntimePathCases)('retains the intended guard sources for $name', fixture => {
    const actual = sources(fixture);

    expect(actual).toEqual(fixture.expected);
  });

  it.each(mixedRuntimePathCases)('retains the intended findings for $name', fixture => {
    const actual = findings(fixture);

    expect(actual).toEqual(fixture.expected === 'unknown' ? ['unguarded'] : ['rename', 'unguarded']);
  });
});
