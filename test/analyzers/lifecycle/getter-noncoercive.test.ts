import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

type Example = { readonly name: string; readonly field: string; readonly members: string; readonly guard: string; readonly expected: readonly string[] | 'unknown'; readonly extra?: string };

const examples: readonly Example[] = [
  { name: 'nullable Date identity condition', field: 'state: Date | null = null;', members: 'get hasClosed(): boolean { return this.state !== null; }', guard: 'if (!this.hasClosed) return;', expected: ['set'] },
  { name: 'nullable Date direct truthiness', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; }', guard: 'if (!this.current) return;', expected: ['set'] },
  { name: 'nullable Date double negation', field: 'state: Date | null = null;', members: 'get hasClosed(): boolean { return !!this.state; }', guard: 'if (!this.hasClosed) return;', expected: ['set'] },
  { name: 'nullable Date chained alias', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; } get chain(): Date | null { return this.current; }', guard: 'if (!this.chain) return;', expected: ['set'] },
  { name: 'nullable Date alias comparison', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; }', guard: 'if (this.current === null) return;', expected: ['set'] },
  { name: 'nullable Date loose nullish identity', field: 'state: Date | null | undefined = null;', members: 'get current(): Date | null | undefined { return this.state; }', guard: 'if (this.current == null) return;', expected: ['set'] },
  { name: 'nullable Date strict split identity', field: 'state: Date | null | undefined = null;', members: 'get current(): Date | null | undefined { return this.state; }', guard: 'if (this.current === null) return;', expected: 'unknown' },
  { name: 'nullable Date split forms composed', field: 'state: Date | null | undefined = null;', members: 'get current(): Date | null | undefined { return this.state; } get hasClosed(): boolean { return this.current !== null && this.current !== undefined; }', guard: 'if (!this.hasClosed) return;', expected: ['set'] },
  { name: 'nullable number falsy set', field: 'state: number | null = null;', members: 'get current(): number | null { return this.state; }', guard: 'if (this.current) return;', expected: ['set', 'unset'] },
  { name: 'nullable string falsy set', field: 'state: string | null = null;', members: 'get current(): string | null { return this.state; }', guard: 'if (this.current) return;', expected: ['set', 'unset'] },
  { name: 'object coercive comparison', field: 'state: Date | null = null;', members: 'other: Date | number = 1; get invalid(): boolean { return this.state == this.other; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'object comparison exit payload', field: 'state: Date | null = null;', members: 'other: Date | number = 1; get invalid(): boolean { return this.state == this.other; }', guard: 'if (this.state !== null) return this.invalid;', expected: 'unknown' },
  { name: 'object method call', field: 'state: Date | null = null;', members: 'get invalid(): boolean { return this.state?.valueOf() === 1; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'object arithmetic', field: 'state: Date | null = null;', members: 'get invalid(): boolean { return +(this.state ?? 0) === 1; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'object includes', field: 'state: Date | null = null;', members: 'get invalid(): boolean { return [this.state].includes(null); }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'unrelated nullable object', field: 'state: Date | null = null;', members: 'other: Date | null = null; get invalid(): boolean { return this.other !== null; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'replaced nullable getter', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; }', guard: 'if (!this.current) return;', expected: 'unknown', extra: "Object.defineProperty(Order.prototype, 'current', { get() { return null; } });" },
  { name: 'leaking nullable getter', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; } expose() { return this; }', guard: 'if (!this.current) return;', expected: 'unknown' },
  { name: 'nullable permission cannot enter includes', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; } get invalid(): boolean { return !!this.current && [this.current, null].includes(null); }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'nullable getter cannot enter scalar exit payload', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; }', guard: 'if (this.state !== null) return this.current;', expected: 'unknown' },
  { name: 'nullable coercion callback', field: 'state: Date | null = null;', members: 'get invalid(): boolean { return Boolean(this.state); }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'nullable property chaining', field: 'state: Date | null = null;', members: 'get invalid(): boolean { return this.state?.constructor !== undefined; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'nullable getter does not grant object comparison', field: 'state: Date | null = null;', members: 'get current(): Date | null { return this.state; } other: Date | number = 1; get invalid(): boolean { return this.current == this.other; }', guard: 'if (!this.invalid) return;', expected: 'unknown' },
  { name: 'unrelated string length switch', field: 'state: Date | null = null;', members: '', guard: 'switch (label.length) { case 0: break; default: break; }', expected: ['set', 'unset'] },
  { name: 'rewritten string parameter switch', field: 'state: Date | null = null;', members: '', guard: 'label = { get length() { throw new Error(); } } as unknown as string; switch (label.length) { case 0: break; default: break; }', expected: 'unknown' },
  { name: 'effectful getter switch', field: 'state: Date | null = null;', members: 'get size(): number { this.label = "effect"; return 0; }', guard: 'switch (this.size) { case 0: break; default: break; }', expected: 'unknown' },
  { name: 'foreign getter switch', field: 'state: Date | null = null;', members: '', guard: 'switch (foreign.size) { case 0: break; default: break; }', expected: 'unknown', extra: 'declare const foreign: { readonly size: number };' },
  { name: 'optional length switch', field: 'state: Date | null = null;', members: '', guard: 'switch (label?.length) { case 0: break; default: break; }', expected: 'unknown' },
  { name: 'dynamic length switch', field: 'state: Date | null = null;', members: "key: 'length' = 'length';", guard: 'switch (label[this.key]) { case 0: break; default: break; }', expected: 'unknown' },
];

const setup = (example: Example) => {
  const project = inMemoryProject({ '/order.ts': `export class Order {
    ${example.field}
    label = '';
    ${example.members}
    rename(label: string) { ${example.guard} this.label = label; }
    unguarded(label: string) { this.label = label; }
  } ${example.extra ?? ''}` });
  const file = project.getSourceFileOrThrow('/order.ts');
  const cls = file.getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: cls, fields: [{ name: 'state', terminal: ['set'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: [file], projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates.find(candidate => candidate.name === 'Order')!;
  const sources = describeSources(aggregate.methods.find(candidate => candidate.name === 'rename')!.fields.get('state')!.sources);
  return { project, model, sources };
};

describe('operation-specific selected nullable reads', () => {
  it.each(examples)('$name has diagnostic-free source', example => {
    const { project } = setup(example);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(examples)('$name has no extraction problems', example => {
    const { model } = setup(example);

    expect(model.problems).toEqual([]);
  });

  it.each(examples)('$name preserves exact sources', example => {
    const { sources } = setup(example);

    expect(sources).toEqual(example.expected);
  });

  it.each(examples)('$name preserves terminal findings', example => {
    const { model } = setup(example);
    const expected = example.expected !== 'unknown' && example.expected.includes('set') ? ['rename', 'unguarded'] : ['unguarded'];
    const actual = lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);

    expect(actual).toEqual(expected);
  });
});
