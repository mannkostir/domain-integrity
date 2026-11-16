import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import { evaluateCondition } from '../../../src/analyzers/lifecycle/guard-condition';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

type Case = readonly [string, string, string, string, readonly string[] | 'unknown', string?];

const cases: readonly Case[] = [
  ['broad enum literal', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.state === this.closedValue', ['open']],
  ['commuted enum literal', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.closedValue === this.state', ['open']],
  ['state alias', 'state: State = State.Open;', 'get current(): State { return this.state; }', 'this.current === State.Closed', ['open']],
  ['commuted state alias', 'state: State = State.Open;', 'get current(): State { return this.state; }', 'State.Closed === this.current', ['open']],
  ['getter chains', 'state: State = State.Open;', 'get current(): State { return this.state; } get chain(): State { return this.current; } get closedValue(): State { return State.Closed; }', 'this.chain === this.closedValue', ['open']],
  ['inequality', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.state !== this.closedValue', ['closed']],
  ['string literal', "state: 'open' | 'closed' = 'open';", "get closedValue(): 'open' | 'closed' { return 'closed'; }", 'this.state === this.closedValue', ['open']],
  ['boolean literal', 'state: boolean = false;', 'get closedValue(): boolean { return true; }', 'this.state === this.closedValue', ['false']],
  ['boolean versus string', 'state: boolean = false;', "get closedValue(): string | boolean { return 'true'; }", 'this.state === this.closedValue', ['false', 'true']],
  ['string versus boolean', "state: 'false' | 'true' | 'unset' = 'false';", 'get closedValue(): boolean | string { return true; }', 'this.state === this.closedValue', ['false', 'true', 'unset']],
  ['strict null', 'state: boolean | null | undefined = false;', 'get empty(): boolean | null | undefined { return null; }', 'this.state === this.empty', 'unknown'],
  ['loose null', 'state: boolean | null | undefined = false;', 'get empty(): boolean | null | undefined { return null; }', 'this.state == this.empty', ['false', 'true']],
  ['strict undefined', 'state: boolean | null | undefined = false;', 'get empty(): boolean | null | undefined { return undefined; }', 'this.state === this.empty', 'unknown'],
  ['includes operands', 'state: State = State.Open;', 'get current(): State { return this.state; } get closedValue(): State { return State.Closed; }', '[this.closedValue].includes(this.current)', ['open']],
  ['predicate composition', 'state: State = State.Open;', 'get current(): State { return this.state; } get closedValue(): State { return State.Closed; } isClosed() { return this.current === this.closedValue; }', 'this.isClosed()', ['open']],
  ['private getters', 'state: State = State.Open;', 'get #current(): State { return this.state; } get #closedValue(): State { return State.Closed; }', 'this.#current === this.#closedValue', ['open']],
  ['loose enum literal', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.closedValue == this.state', ['open']],
  ['arrow predicate composition', 'state: State = State.Open;', 'get current(): State { return this.state; } get closedValue(): State { return State.Closed; } isClosed = () => this.current === this.closedValue;', 'this.isClosed()', ['open']],
  ['getter returning predicate', 'state: State = State.Open;', 'get current(): boolean { return this.isClosed(); } isClosed() { return this.state === State.Closed; }', 'this.current', ['open']],
  ['literal annotation proven', 'state: State = State.Open;', 'get closedValue(): State.Closed { return State.Closed; }', 'this.state === this.closedValue', ['open']],
  ['depth exhausted', 'state: State = State.Open;', 'get a(): State { return this.b; } get b(): State { return this.c; } get c(): State { return this.d; } get d(): State { return this.e; } get e(): State { return this.f; } get f(): State { return this.state; }', 'this.a === State.Closed', 'unknown'],
  ['indirect recursion', 'state: State = State.Open;', 'get a(): State { return this.b; } get b(): State { return this.a; }', 'this.a === State.Closed', 'unknown'],
  ['foreign getter', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.state === foreign.closedValue', 'unknown', 'declare const foreign: { closedValue: State.Closed };'],
  ['replaced getter', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.state === this.closedValue', 'unknown', "Object.defineProperty(Order.prototype, 'closedValue', { get() { return State.Open; } });"],
  ['shadowed undefined', 'state: boolean | null | undefined = false;', 'get empty(): boolean | null | undefined { return undefined; }', 'this.state === this.empty', 'unknown', 'const undefined = null;'],
  ['getter array', 'state: State = State.Open;', 'get values(): State[] { return [State.Closed]; }', 'this.values.includes(this.state)', 'unknown'],
  ['spread includes', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', '[...[this.closedValue]].includes(this.state)', 'unknown'],
  ['extra includes argument', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', '[this.closedValue].includes(this.state, 0)', 'unknown'],
  ['cast effectful getter', 'state: State = State.Open;', 'get current(): State { return this.state; } get openValue(): State.Open { throw new Error(); }', 'this.current === (this.openValue as State.Open)', 'unknown'],
  ['satisfies effectful getter', 'state: State = State.Open;', 'get current(): State { return this.state; } get openValue(): State.Open { throw new Error(); }', 'this.current === (this.openValue satisfies State.Open)', 'unknown'],
  ['non-null effectful getter', 'state: State = State.Open;', 'get current(): State { return this.state; } get openValue(): State.Open { throw new Error(); }', 'this.current === this.openValue!', 'unknown'],
  ['comma effectful operand', 'state: State = State.Open;', 'get current(): State { return this.state; }', "this.current === (this.label = 'effect', State.Open)", 'unknown'],
  ['conditional effectful operand', 'state: State = State.Open;', 'get current(): State { return this.state; } get stop(): boolean { throw new Error(); }', 'this.current === (this.stop ? State.Open : State.Open)', 'unknown'],
  ['both tracked sides', 'state: State = State.Open;', 'get current(): State { return this.state; }', 'this.current === this.state', 'unknown'],
  ['tracked constant side', 'state: State = State.Open;', 'get current(): State { return this.state; }', 'this.state === this.current', 'unknown'],
  ['mutable union', 'state: State = State.Open;', 'other: State = State.Open; get closedValue(): State { return this.other; }', 'this.state === this.closedValue', 'unknown'],
  ['multiple statements', 'state: State = State.Open;', "get closedValue(): State.Closed { this.label = 'effect'; return State.Closed; }", 'this.state === this.closedValue', 'unknown'],
  ['opaque literal getter', 'state: State = State.Open;', 'get closedValue(): State.Closed { return opaque(); }', 'this.state === this.closedValue', 'unknown', 'declare function opaque(): State.Closed;'],
  ['tracked write', 'state: State = State.Open;', 'get closedValue(): State.Closed { return this.state = State.Closed; }', 'this.state === this.closedValue', 'unknown'],
  ['recursive getter', 'state: State = State.Open;', 'get closedValue(): State { return this.closedValue; }', 'this.state === this.closedValue', 'unknown'],
  ['optional getter', 'state: State = State.Open;', 'get closedValue(): State { return State.Closed; }', 'this.state === this?.closedValue', 'unknown'],
  ['dynamic getter', 'state: State = State.Open;', "key: 'closedValue' = 'closedValue'; get closedValue(): State { return State.Closed; }", 'this.state === this[this.key]', 'unknown'],
  ['method operand', 'state: State = State.Open;', 'closedValue(): State { return State.Closed; }', 'this.state === this.closedValue()', 'unknown'],
  ['state-dependent includes element', 'state: State = State.Open;', 'get current(): State { return this.state; }', '[this.current].includes(this.state)', 'unknown'],
  ['effectful unrelated getter', 'state: State = State.Open;', "get closedValue(): State.Closed { this.label = 'effect'; return State.Closed; }", 'this.closedValue === State.Closed', 'unknown'],
];

const setup = (entry: Case, body?: string) => {
  const [, field, members, condition, , extra = ''] = entry;
  const project = inMemoryProject({ '/order.ts': `
    enum State { Open = 'open', Closed = 'closed' }
    export class Order {
      ${field}
      label = '';
      ${members}
      rename(label: string) { ${body ?? `if (${condition}) return; this.label = label;`} }
      unguarded(label: string) { this.label = label; }
    }
    ${extra}
  ` });
  const file = project.getSourceFileOrThrow('/order.ts');
  const cls = file.getClassOrThrow('Order');
  const terminal = field.includes('State') || field.includes("'open'") ? 'closed' : 'true';
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'state', terminal: [terminal], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: [file], projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates.find(candidate => candidate.name === 'Order')!;
  return { project, cls, model, sources: describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('state')!.sources) };
};

describe('proven getter comparison operands', () => {
  it.each(cases.map(entry => ({ name: entry[0], entry })))('$name has diagnostic-free source', ({ entry }) => {
    const { project } = setup(entry);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(cases.map(entry => ({ name: entry[0], entry })))('$name has no extraction problems', ({ entry }) => {
    const { model } = setup(entry);

    expect(model.problems).toEqual([]);
  });

  it.each(cases.map(entry => ({ name: entry[0], entry })))('$name retains exact sources', ({ entry }) => {
    const actual = setup(entry).sources;

    expect(actual).toEqual(entry[4]);
  });

  it.each(cases.map(entry => ({ name: entry[0], entry })))('$name retains exact terminal findings', ({ entry }) => {
    const { model } = setup(entry);
    const expectedSources = entry[4];
    const terminal = entry[1].includes('State') || entry[1].includes("'open'") ? 'closed' : 'true';
    const expected = expectedSources !== 'unknown' && expectedSources.includes(terminal) ? ['rename', 'unguarded'] : ['unguarded'];
    const actual = lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);

    expect(actual).toEqual(expected);
  });
});

const enumCase = cases[4]!;

describe('getter switch operands', () => {
  it.each([
    ['getter discriminant', 'switch (this.chain) { case State.Closed: return; default: break; }'],
    ['getter label', 'switch (this.state) { case this.closedValue: return; default: break; }'],
    ['both getter operands', 'switch (this.chain) { case this.closedValue: return; default: break; }'],
  ])('%s retains exact sources', (_name, guard) => {
    const { sources } = setup(enumCase, `${guard} this.label = label;`);

    expect(sources).toEqual(['open']);
  });
});

describe('getter nullish identity', () => {
  it.each([
    ['null', ['unset:null'], ['false', 'true', 'unset:undefined']],
    ['undefined', ['unset:undefined'], ['false', 'true', 'unset:null']],
  ] as const)('separates strict %s before public unset collapse', (literal, whenTrue, whenFalse) => {
    const entry: Case = ['nullish', 'state: boolean | null | undefined = false;', `get empty(): boolean | null | undefined { return ${literal}; }`, 'this.state === this.empty', 'unknown'];
    const { cls } = setup(entry);
    const condition = cls.getMethodOrThrow('rename').getFirstDescendantByKindOrThrow(SyntaxKind.IfStatement).getExpression();
    const actual = evaluateCondition(condition, resolvedField(cls, 'state'), defaultScope(cls));

    expect(actual).toEqual({ whenTrue: new Set(whenTrue), whenFalse: new Set(whenFalse) });
  });
});

describe('getter root work limits', () => {
  it('rejects a switch whose complete labels exhaust shared work', () => {
    const labels = Array.from({ length: 140 }, () => 'case this.closedValue:').join(' ');
    const { sources } = setup(enumCase, `switch (this.chain) { ${labels} return; default: break; } this.label = label;`);

    expect(sources).toBe('unknown');
  });

  it('rejects a branching comparison root after shared work exhaustion', () => {
    const condition = Array.from({ length: 90 }, () => 'this.current === this.closedValue').join(' || ');
    const { sources } = setup(enumCase, `if (${condition}) return; this.label = label;`);

    expect(sources).toBe('unknown');
  });

  it('retains the first matching duplicate getter label', () => {
    const { sources } = setup(enumCase, 'switch (this.chain) { case this.closedValue: break; case this.closedValue: return; default: break; } this.label = label;');

    expect(sources).toEqual(['closed', 'open']);
  });

  it('retains default work with getter labels and empty fallthrough', () => {
    const { sources } = setup(enumCase, 'switch (this.chain) { case this.closedValue: return; default: this.label = label; break; }');

    expect(sources).toEqual(['open']);
  });

  it('rejects a state-dependent getter label without dropping it', () => {
    const { sources } = setup(enumCase, 'switch (this.chain) { case this.current: return; default: break; } this.label = label;');

    expect(sources).toBe('unknown');
  });
});
