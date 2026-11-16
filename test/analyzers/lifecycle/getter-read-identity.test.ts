import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeSources } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

type ReadCase = {
  readonly name: string;
  readonly members: string;
  readonly condition: string;
  readonly expected: readonly string[] | 'unknown';
  readonly extra?: string;
  readonly field?: string;
};

const cases: readonly ReadCase[] = [
  { name: 'asserted original receiver', members: '', condition: '(this as { state: unknown }).state === false', expected: ['true'] },
  { name: 'non-null original receiver', members: '', condition: 'this!.state === false', expected: ['true'] },
  { name: 'parenthesized original receiver', members: '', condition: '(this).state === false', expected: ['true'] },
  { name: 'literal element key', members: '', condition: "this['state'] === false", expected: ['true'] },
  { name: 'asserted data holder', field: '', members: 'props: { state: boolean } = { state: false };', condition: '(this.props as { state: unknown }).state === false', expected: ['true'] },
  { name: 'copy getter holder', field: '', members: 'get props(): { state: boolean } { return { state: false }; }', condition: '(this.props as { state: unknown }).state === false', expected: 'unknown' },
  { name: 'assertion inventing holder field', members: 'props = { other: false };', condition: '(this.props as unknown as { state: boolean }).state === false', expected: 'unknown' },
  { name: 'assertion inventing own field', members: '', condition: '(this as unknown as { other: boolean }).other === false', expected: 'unknown' },
  { name: 'foreign literal getter', members: '', condition: 'this.state === foreign.state', expected: 'unknown', extra: 'declare const foreign: { readonly state: false };' },
  { name: 'optional original receiver', members: '', condition: '(this as { state: boolean })?.state === false', expected: 'unknown' },
  { name: 'dynamic original key', members: "key: 'state' = 'state';", condition: 'this[this.key] === false', expected: 'unknown' },
  { name: 'wrapped getter remains outside operand grammar', members: 'get current(): boolean { return this.state; }', condition: '(this.current as boolean) === false', expected: 'unknown' },
];

const setup = (entry: ReadCase) => {
  const project = inMemoryProject({ '/order.ts': `
    export class Order {
      ${entry.field ?? 'state: boolean = false;'}
      label = '';
      ${entry.members}
      rename(label: string) { if (${entry.condition}) return; this.label = label; }
      unguarded(label: string) { this.label = label; }
    }
    ${entry.extra ?? ''}
  ` });
  const file = project.getSourceFileOrThrow('/order.ts');
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: file.getClassOrThrow('Order'), fields: [{ name: 'state', terminal: ['true'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }] },
    files: [file], projectRoot: '/', repositoryRoot: '/',
  });
  const aggregate = model.aggregates.find(candidate => candidate.name === 'Order')!;
  return { project, model, sources: describeSources(aggregate.methods.find(method => method.name === 'rename')!.fields.get('state')!.sources) };
};

describe('original tracked read identity', () => {
  it.each(cases)('$name has diagnostic-free source', entry => {
    const { project } = setup(entry);

    expect(project.getPreEmitDiagnostics().map(diagnostic => diagnostic.getMessageText())).toEqual([]);
  });

  it.each(cases)('$name has no extraction problems', entry => {
    const { model } = setup(entry);

    expect(model.problems).toEqual([]);
  });

  it.each(cases)('$name preserves exact sources', entry => {
    const { sources } = setup(entry);

    expect(sources).toEqual(entry.expected);
  });

  it.each(cases)('$name retains the deliberate unguarded finding', entry => {
    const { model } = setup(entry);
    const findings = lifecycleAnalyzer.check(model).filter(finding => finding.ruleId === 'terminal-state-leak').map(finding => finding.details.method);

    expect(findings).toEqual(entry.expected === 'unknown' ? ['unguarded'] : ['rename', 'unguarded']);
  });
});
