import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const base = `export class Order {
  closed = false; label = '';
  private buffer: object[] = [];
  protected record(payload: object) { this.buffer.push(payload); }
  isClosed() { return false; }
  rename() { if (this.isClosed()) return; this.label = 'changed'; }
  unguarded() { this.label = 'unguarded'; }
  notify() { this.record({ kind: 'safe' }); }
}`;
const iterable = (type: string, operand = 'this.steps', generic = '') => base
  .replace('export class Order {', `export class Order${generic} {`)
  .replace('closed = false;', `private steps: ${type}; constructor(steps: ${type}) { this.steps = steps; } run() { for (const value of ${operand}) {} } closed = false;`);
const data = (type: string, prefix = '') => prefix + base.replace('closed = false;', `private mode: ${type}; constructor(mode: ${type}) { this.mode = mode; } inspect() { return this.mode; } closed = false;`);
const unsafe = [
  ['object union', iterable('Iterable<string> | string')],
  ['object intersection', iterable('Iterable<string> & { tag?: string }')],
  ['nullish object union', iterable('Iterable<string> | null', "(this.steps ?? '')")],
  ['plain object', iterable('Iterable<string>')],
  ['constrained parameter', iterable('T', 'this.steps', '<T extends Iterable<string> | string>')],
] as const;
const safe = [
  ['string iteration', iterable('string')],
  ['nullable Boolean', data('boolean | null')],
  ['nullable enum', data('Mode | null', "enum Mode { One = 'one', Two = 'two' } ")],
  ['number', data('number')],
  ['bigint', data('bigint')],
  ['nullish primitive literals', data("'one' | 1 | true | null | undefined")],
] as const;
const inspect = (text: string) => {
  const project = inMemoryProject({ '/order.ts': text });
  const file = project.getSourceFileOrThrow('/order.ts');
  const target = file.getClassOrThrow('Order');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, eventMethods: ['record'], lifecycles: [{ target, fields: [{ name: 'closed', terminal: ['true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: [file], projectRoot: '/', repositoryRoot: '/',
  });
  return { project, problems: model.problems, sources: describeSources(model.aggregates[0]!.methods.find(method => method.name === 'rename')!.fields.get('closed')!.sources), findings: lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method) };
};

describe('affirmative primitive data representation', () => {
  it.each([...unsafe, ...safe])('uses diagnostic-free authored input for %s', (_name, text) => {
    const result = inspect(text);

    expect([result.project.getPreEmitDiagnostics().length, result.problems]).toEqual([0, []]);
  });
  it.each(unsafe)('keeps %s guarded sources unknown', (_name, text) => {
    expect(inspect(text).sources).toBe('unknown');
  });
  it.each(unsafe)('keeps the guarded finding silent beside %s', (_name, text) => {
    expect(inspect(text).findings).not.toContain('rename');
  });
  it.each([...unsafe, ...safe])('retains the deliberate unguarded finding beside %s', (_name, text) => {
    expect(inspect(text).findings).toContain('unguarded');
  });
  it.each(safe)('retains precise sources for %s', (_name, text) => {
    expect(inspect(text).sources).toEqual(['false', 'true']);
  });
  it.each(safe)('retains the real guarded-method finding for %s', (_name, text) => {
    expect(inspect(text).findings).toContain('rename');
  });
});
