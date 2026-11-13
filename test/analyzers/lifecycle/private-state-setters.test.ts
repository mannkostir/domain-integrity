import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const privateState = "#state: 'open' | 'closed' = 'open';";
const shadowState = "#state: 'open' | 'closed' = 'closed';";

const sourceWith = (derivedFields = shadowState, statement = "if (this.#state === 'open') return; this.label = 'x';") => `
class Base {
  ${privateState}
  title = '';
  get label(): string { return this.#state; }
  set label(value: string) { this.title = value; }
  rename(): void { ${statement} }
}
export class Order extends Base { ${derivedFields} }
`;

const projectWith = (source: string) => inMemoryProject({ '/src/order.ts': source });

const sourcesOf = (source: string, field = '#state') => {
  const file = projectWith(source).getSourceFileOrThrow('/src/order.ts');
  const base = file.getClassOrThrow('Base');
  const cls = file.getClassOrThrow('Order');
  return describeSources(methodSources(base.getMethodOrThrow('rename'), resolvedField(cls, field), defaultScope(cls)));
};

const modelOf = (source: string) => {
  const project = projectWith(source);
  const file = project.getSourceFileOrThrow('/src/order.ts');
  return lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{
        target: file.getClassOrThrow('Order'),
        fields: [{ name: '#state', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }],
        allowAfterTerminal: [],
      }],
    },
    files: [file],
    projectRoot: '/',
    repositoryRoot: '/',
  });
};

describe('plain setter exemption with ambiguous private state identity', () => {
  it('keeps the inherited method unknown when its private state is a different brand', () => {
    expect(sourcesOf(sourceWith())).toBe('unknown');
  });

  it('does not report a terminal leak from a guard on another private brand', () => {
    expect(lifecycleAnalyzer.check(modelOf(sourceWith())).filter((finding) => finding.ruleId === 'terminal-state-leak')).toEqual([]);
  });

  it('does not invent an extraction problem for valid same-spelled private fields', () => {
    expect(modelOf(sourceWith()).problems).toEqual([]);
  });

  it('typechecks the review reproduction', () => {
    expect(projectWith(sourceWith()).getPreEmitDiagnostics()).toEqual([]);
  });

  it('retains the benefit when the inherited private state has a single brand', () => {
    expect(sourcesOf(sourceWith(''))).toEqual(['closed']);
  });

  it('does not confuse public overriding fields with private brands', () => {
    expect(sourcesOf(sourceWith().replaceAll('#state', 'state'), 'state')).toEqual(['closed']);
  });

  it('does not suppress the exemption for unrelated duplicate private fields', () => {
    const source = sourceWith('#other = 1;').replace(privateState, `${privateState} #other = 0;`);

    expect(sourcesOf(source)).toEqual(['closed']);
  });

  it('keeps the same ambiguity conservative through a setter-only member', () => {
    const source = sourceWith().replace('get label(): string { return this.#state; }', '');

    expect(sourcesOf(source)).toBe('unknown');
  });

  it('retains getter reads during a compound assignment with ambiguous private state', () => {
    expect(sourcesOf(sourceWith(shadowState, "this.label += 'x';"))).toBe('unknown');
  });

  it('retains numeric getter reads during update with ambiguous private state', () => {
    const source = sourceWith(shadowState, 'this.label++;')
      .replace('get label(): string { return this.#state; }', 'get label(): number { return this.#state.length; }')
      .replace("title = '';", 'title = 0;')
      .replace('set label(value: string)', 'set label(value: number)');

    expect(sourcesOf(source)).toBe('unknown');
  });
});
