import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { evaluateCondition } from '../../../src/analyzers/lifecycle/guard-condition';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';
import { SyntaxKind } from 'ts-morph';

const scenario = (field: string, members: string, condition = 'this.isClosed()', extra = '', body = `if (${condition}) return; this.label = label;`) => {
  const project = inMemoryProject({ '/src/order.ts': `
    enum State { Open = 'open', Closed = 'closed' }
    export class Order {
      ${field}
      label = '';
      ${members}
      rename(label: string) { ${body} }
      unguarded(label: string): void { this.label = label; }
    }
    ${extra}
  ` });
  const file = project.getSourceFileOrThrow('/src/order.ts');
  const cls = file.getClassOrThrow('Order');
  const state = resolvedField(cls, 'closed');
  const scope = defaultScope(cls);
  return { project, file, cls, state, scope };
};

const sources = (field: string, members: string, condition?: string, extra?: string) => {
  const { cls, state, scope } = scenario(field, members, condition, extra);
  return describeSources(methodSources(cls.getMethodOrThrow('rename'), state, scope));
};

const BOOLEAN = 'closed: boolean = false;';

const positiveCases = [
  [BOOLEAN, 'isClosed() { return this.closed; }', ['false']],
  ['closed: boolean | null = false;', 'isClosed() { return this.closed === true; }', ['false', 'unset']],
  ["closed: 'open' | 'closed' = 'open';", "isClosed() { return this.closed === 'closed'; }", ['open']],
  ['closed: State = State.Open;', 'isClosed() { return this.closed === State.Closed; }', ['open']],
] as const;

describe('bounded scalar predicate guards', () => {
  it.each(positiveCases)('checks diagnostics for %s', (field, members) => {
    const { project } = scenario(field, members);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(positiveCases)('narrows %s', (field, members, expected) => {
    const actual = sources(field, members);

    expect(actual).toEqual(expected);
  });

  it.each([
    ['true', []],
    ['false', ['false', 'true']],
    ['!false', []],
    ['!(true && false)', []],
  ] as const)('partitions constant %s exactly', (expression, expected) => {
    const actual = sources(BOOLEAN, `isClosed() { return ${expression}; }`);

    expect(actual).toEqual(expected);
  });

  it.each([
    ['isClosed() { return this.closed; }', '!this.isClosed()', ['true']],
    ['isClosed() { return this.nested(); } nested() { return this.closed; }', 'this.isClosed()', ['false']],
    ['isClosed() { return this.flag; } get flag() { return true; }', 'this.isClosed()', []],
    ['isClosed() { return this.flag; } get flag() { return false; }', 'this.isClosed()', ['false', 'true']],
    ['isClosed() { return this.flag; } get flag() { return this.closed; }', 'this.isClosed()', ['false']],
    ['isClosed = () => this.closed;', 'this.isClosed()', ['false']],
    ['#isClosed() { return this.closed; }', 'this.#isClosed()', ['false']],
    ['isClosed() { return this.closed && true; }', 'this.isClosed()', ['false']],
    ['isClosed() { return false || this.closed; }', 'this.isClosed()', ['false']],
    ['isClosed() { return ([true]).includes(this.closed); }', 'this.isClosed()', ['false']],
    ['isClosed() { return [true].includes(this.closed); }', 'this.isClosed()', ['false']],
  ] as const)('follows %s', (members, condition, expected) => {
    const actual = sources(BOOLEAN, members, condition);

    expect(actual).toEqual(expected);
  });

  it('preserves the deliberately unguarded positive', () => {
    const { cls, state, scope } = scenario(BOOLEAN, 'isClosed() { return this.closed; }');

    expect(describeSources(methodSources(cls.getMethodOrThrow('unguarded'), state, scope))).toEqual(['false', 'true']);
  });

  it('uses the existing condition evaluator for both partitions', () => {
    const { cls, state, scope } = scenario(BOOLEAN, 'isClosed() { return this.closed; }');
    const condition = cls.getMethodOrThrow('rename').getFirstDescendantByKindOrThrow(SyntaxKind.IfStatement).getExpression();
    const actual = evaluateCondition(condition, state, scope);

    expect(actual).toEqual({ whenTrue: new Set(['true']), whenFalse: new Set(['false']) });
  });

  it.each(positiveCases)('reports only the unguarded mutation for %s', (field, members) => {
    const { cls, file } = scenario(field, members);
    const terminal = field.includes('State') || field.includes("'open'") ? 'closed' : 'true';
    const model = lifecycleAnalyzer.extract({
      declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'closed', terminal: [terminal], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
      files: [file], projectRoot: '/', repositoryRoot: '/',
    });
    const actual = lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);

    expect(actual).toEqual(['unguarded']);
  });
});

const rejectedExamples: readonly (readonly [string, string, string?, string?])[] = [
  ['statements before return', 'isClosed() { this.label = "effect"; return this.closed; }'],
  ['unrelated assignment in return', 'isClosed() { return (this.label = "effect") === "effect"; }'],
  ['state assignment', 'isClosed() { return this.closed = true; }'],
  ['comma', 'isClosed() { return (this.label = "effect", this.closed); }'],
  ['update', 'count = 0; isClosed() { return ++this.count === 1; }'],
  ['delete', 'value?: boolean; isClosed() { return delete this.value; }'],
  ['coercion', 'isClosed() { return Boolean(this.closed); }'],
  ['new', 'isClosed() { return new Boolean(this.closed); }'],
  ['foreign read', 'other = { closed: false }; isClosed() { return this.other.closed; }'],
  ['effectful literal getter', 'get effect(): true { this.label = "effect"; return true; } isClosed() { return this.effect; }'],
  ['effectful literal method', 'effect(): true { this.label = "effect"; return true; } isClosed() { return this.effect(); }'],
  ['opaque literal call', 'isClosed() { return opaque(); }', 'this.isClosed()', 'declare function opaque(): true;'],
  ['cycle', 'isClosed(): boolean { return this.nested(); } nested(): boolean { return this.isClosed(); }'],
  ['getter cycle', 'isClosed(): boolean { return this.flag; } get flag(): boolean { return this.isClosed(); }'],
  ['async', 'async isClosed() { return this.closed; }', 'this.isClosed() !== undefined'],
  ['generator', '*isClosed() { return this.closed; }'],
  ['overload', 'isClosed(): boolean; isClosed() { return this.closed; }'],
  ['default parameter', 'isClosed(value = false) { return this.closed || value; }'],
  ['rest parameter', 'isClosed(...values: boolean[]) { return this.closed || values.length > 0; }'],
  ['optional parameter', 'isClosed(value?: boolean) { return this.closed || value; }'],
  ['generic', 'isClosed<T>() { return this.closed; }'],
  ['arguments', 'isClosed(value: boolean) { return this.closed || value; }', 'this.isClosed(false)'],
  ['optional call', 'isClosed() { return this.closed; }', 'this.isClosed?.()'],
  ['optional member', 'isClosed() { return this.closed; }', 'this?.isClosed()'],
  ['element call', 'isClosed() { return this.closed; }', "this['isClosed']()"],
  ['replacement', 'isClosed() { return this.closed; }', 'this.isClosed()', 'Order.prototype.isClosed = () => true;'],
  ['subclass override', 'isClosed() { return this.closed; }', 'this.isClosed()', 'class Derived extends Order { isClosed() { return true; } }'],
  ['instance shadow', 'isClosed() { return this.closed; }', 'this.isClosed()', 'const order = new Order(); order.isClosed = () => true;'],
  ['reflection', 'isClosed() { return this.closed; }', 'this.isClosed()', 'Object.defineProperty(Order.prototype, "isClosed", { value: () => true });'],
  ['foreign receiver', 'isClosed() { return this.closed; } other() { return { isClosed: () => true }; }', 'this.other().isClosed()'],
  ['static context', 'static isClosed() { return true; }', 'Order.isClosed()'],
  ['shadowed undefined', 'isClosed() { return this.closed === undefined; }', 'this.isClosed()', 'const undefined = true;'],
  ['constructor exposure', 'initialized = initialize(this.constructor); isClosed() { return false; }', 'this.isClosed()', 'declare function initialize(ctor: Function): string;'],
  ['unchecked equality call', 'isClosed(value = false) { this.label = "effect"; return value; }', 'this.isClosed(true) === true'],
  ['dynamic code', 'isClosed() { return false; }', 'this.isClosed()', 'eval("Order.prototype.isClosed = () => true");'],
  ['non-Boolean literal condition', "isClosed() { return 'closed'; }"],
  ['unrelated constant comparison', 'isClosed() { return true === true; }'],
  ['factory result escape', 'isClosed() { return false; }', 'this.isClosed()', "declare function make(): Order; declare function replace(payload: { target: Order }): void; replace({ 'target': make() });"],
  ['stored instance escape', 'isClosed() { return false; }', 'this.isClosed()', "declare const holder: { target: Order }; declare function replace(payload: { target: Order }): void; replace({ 'target': holder['target'] });"],
  ['constructed instance escape', 'isClosed() { return false; }', 'this.isClosed()', "declare function replace(payload: { target: Order }): void; replace({ 'target': new Order() });"],
  ['generic instance escape', 'isClosed() { return false; }', 'this.isClosed()', 'declare function replace(payload: { target: Order }): void; export function use<T extends Order>(order: T) { replace({ target: order }); }'],
  ['union instance escape', 'isClosed() { return false; }', 'this.isClosed()', 'declare function replace(payload: { target: object }): void; export function use(order: Order | { closed: boolean }) { replace({ target: order }); }'],
  ['nested instance escape', 'isClosed() { return false; }', 'this.isClosed()', 'declare function replace(payload: { target: Order }): void; export function use(order: Order) { replace({ target: order }); }'],
  ['prototype alias escape', 'isClosed() { return false; }', 'this.isClosed()', 'const payload = { target: Order }; declare function replace(payload: { target: typeof Order }): void; replace(payload);'],
  ['prototype parent write', 'isClosed() { return false; }', 'this.isClosed()', 'const target = Order.prototype as unknown as Record<string, unknown>; target.__proto__ = { isClosed: () => true };'],
  ['replaced includes', 'isClosed() { return [false].includes(this.closed); }', 'this.isClosed()', 'Array.prototype.includes = function () { return true; };'],
  ['unrelated decorator', '@decorate other = false; isClosed() { return false; }', 'this.isClosed()', 'declare function decorate(value: undefined, context: ClassFieldDecoratorContext): void;'],
  ['coerced object equality', 'get value(): Date { return new Date(); } isClosed() { return this.value == null; }'],
] as const;

const rejectedCases = rejectedExamples.map(([name, members, condition, extra]) => ({ name, members, condition, extra }));

describe('scalar predicate uncertainty', () => {
  it.each(rejectedCases)('uses valid source for $name', ({ members, condition, extra }) => {
    const { project } = scenario(BOOLEAN, members, condition, extra);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(rejectedCases)('keeps $name unknown', ({ members, condition, extra }) => {
    const actual = sources(BOOLEAN, members, condition, extra);

    expect(actual).toBe('unknown');
  });

  it('bounds recursive predicate depth', () => {
    const members = Array.from({ length: 7 }, (_, index) => `p${index}(): boolean { return ${index === 6 ? 'this.closed' : `this.p${index + 1}()`}; }`).join('\n');
    const actual = sources(BOOLEAN, members, 'this.p0()');

    expect(actual).toBe('unknown');
  });

  it('uses diagnostic-free work exhaustion source', () => {
    const expression = Array.from({ length: 200 }, () => '(this.closed)').join(' || ');
    const { project } = scenario(BOOLEAN, `isClosed() { return ${expression}; }`);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it('shares the work budget between logical branches', () => {
    const leaf = 'this.closed';
    const expression = Array.from({ length: 200 }, () => `(${leaf})`).join(' || ');
    const actual = sources(BOOLEAN, `isClosed() { return ${expression}; }`);

    expect(actual).toBe('unknown');
  });
});


const flowCases = [
  ['throw', 'if (this.isClosed()) throw new Error("closed"); this.label = label;'],
  ['wrapper', 'if (!this.isClosed()) { this.label = label; }'],
  ['assertion helper', 'this.assertOpen(); this.label = label;'],
  ['returned predicate', 'if (this.isClosed()) return this.isClosed(); this.label = label;'],
  ['returned getter', 'if (this.isClosed()) return this.flag; this.label = label;'],
  ['guard before overwrite', 'if (this.isClosed()) return; this.closed = true; this.label = label;'],
  ['guard after overwrite', 'this.closed = false; if (this.isClosed()) return; this.label = label;'],
] as const;

const flowScenario = (body: string) => scenario(BOOLEAN, `
  isClosed() { return this.closed; }
  get flag() { return this.closed; }
  assertOpen() { if (this.isClosed()) throw new Error('closed'); }
`, undefined, undefined, body);

describe('scalar predicates in guard consumers', () => {
  it.each(flowCases)('has valid source for %s', (_name, body) => {
    const { project } = flowScenario(body);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(flowCases)('keeps the correct sources for %s', (name, body) => {
    const { cls, state, scope } = flowScenario(body);
    const actual = describeSources(methodSources(cls.getMethodOrThrow('rename'), state, scope));

    expect(actual).toEqual(name === 'guard after overwrite' ? ['false', 'true'] : ['false']);
  });
});

describe('predicate dispatch beside ordinary aggregate work', () => {
  it('retains an ordinary constructed receiver', () => {
    const actual = sources(BOOLEAN, 'isClosed() { return this.closed; }', undefined, 'const order = new Order(); order.rename("x");');

    expect(actual).toEqual(['false']);
  });

  it('retains a guard beside an unrelated event payload', () => {
    const actual = sources(BOOLEAN, 'record(event: object) { void event; } isClosed() { return this.closed; } emit() { this.record({}); }');

    expect(actual).toEqual(['false']);
  });
});

const dispatchCases = [
  ['constructor replacement', 'constructor() { return { closed: false, label: "", isClosed: () => true, rename: Order.prototype.rename, unguarded: Order.prototype.unguarded }; } isClosed() { return false; }', ''],
  ['proxy replacement', 'isClosed() { return false; }', 'const order = new Proxy(new Order(), { get() { return () => true; } });'],
  ['constructor escape', 'isClosed() { return false; }', 'declare class Replacement { constructor(target: object); } const replacement = new Replacement(Order.prototype);'],
] as const;

describe('runtime scalar dispatch replacements', () => {
  it.each(dispatchCases)('has valid source for %s', (_name, members, extra) => {
    const { project } = scenario(BOOLEAN, members, undefined, extra);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(dispatchCases)('keeps %s unknown', (_name, members, extra) => {
    const actual = sources(BOOLEAN, members, undefined, extra);

    expect(actual).toBe('unknown');
  });
});


const inheritedScenario = (base: string, access: string, opaque = false) => {
  const project = inMemoryProject({
    [opaque ? '/base.d.ts' : '/base.ts']: base,
    '/order.ts': `import { Base } from './base'; export class Order extends Base {
      label = '';
      isClosed() { return this.closed; }
      rename(label: string) { if (${access}) return; this.label = label; }
    }`,
  });
  const cls = project.getSourceFileOrThrow('/order.ts').getClassOrThrow('Order');
  return { project, actual: describeSources(methodSources(cls.getMethodOrThrow('rename'), resolvedField(cls, 'closed'), defaultScope(cls))) };
};

const inheritedCases = [
  ['project inherited call', 'export class Base { closed: boolean = false; isClosed() { return this.closed; } }', 'super.isClosed()', false, ['false']],
  ['project virtual call', 'export class Base { closed: boolean = false; }', 'this.isClosed()', false, ['false']],
  ['opaque inherited construction', 'export declare class Base { closed: boolean; }', 'this.isClosed()', true, 'unknown'],
] as const;

describe('scalar predicate inherited dispatch', () => {
  it.each(inheritedCases)('has valid source for %s', (_name, base, access, opaque) => {
    const { project } = inheritedScenario(base, access, opaque);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(inheritedCases)('proves %s conservatively', (_name, base, access, opaque, expected) => {
    const { actual } = inheritedScenario(base, access, opaque);

    expect(actual).toEqual(expected);
  });
});
