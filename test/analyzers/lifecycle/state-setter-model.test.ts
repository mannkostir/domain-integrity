import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { initialValues } from '../../../src/analyzers/lifecycle/initial';
import { suggestLifecycles } from '../../../src/analyzers/lifecycle/suggest';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { describeAssigned, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const modelOf = (body: string, setterBody = 'this.status = value;', declared = true) => {
  const project = inMemoryProject({ '/src/order.ts': `
    class Base {}
    export class Order extends Base {
      status: 'pending' | 'paid' | 'cancelled' = 'pending';
      title = '';
      set state(value: 'pending' | 'paid' | 'cancelled') { ${setterBody} }
      close(): void { ${body} }
    }
  ` });
  const file = project.getSourceFileOrThrow('/src/order.ts');
  const cls = file.getClassOrThrow('Order');
  return lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      aggregateBaseClasses: ['Base'],
      lifecycles: declared ? [{
        target: cls,
        fields: [{ name: 'status', terminal: ['cancelled'], transitions: new Map([['close', ['pending']]]), allowAfterTerminal: [] }],
        allowAfterTerminal: [],
      }] : [],
    },
    files: [file],
    projectRoot: '/',
    repositoryRoot: '/',
  });
};

const guardedClose = "if (this.status === 'paid') return; this.state = 'cancelled';";

describe('state setter model consistency', () => {
  it('retains the entry sources in the extracted method', () => {
    const model = modelOf(guardedClose);

    expect(describeSources(model.aggregates[0]!.methods[0]!.fields.get('status')!.sources)).toEqual(['cancelled', 'pending']);
  });

  it('retains the caller assignment in the extracted method', () => {
    const model = modelOf(guardedClose);

    expect(describeAssigned(model.aggregates[0]!.methods[0]!.fields.get('status')!.sets)).toEqual({ tokens: ['cancelled'], unresolved: false, mayWrite: false });
  });

  it('reports the terminal entry leak hidden by the setter', () => {
    const model = modelOf(guardedClose);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'terminal-state-leak').map((finding) => finding.details.method)).toEqual(['close']);
  });

  it('reports transition drift using the same entry sources', () => {
    const model = modelOf(guardedClose);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'transition-drift').map((finding) => finding.details.values)).toEqual([['cancelled']]);
  });

  it('does not report a setter-assigned value as unreachable', () => {
    const model = modelOf(guardedClose);

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'unreachable-state').map((finding) => finding.details.value)).not.toContain('cancelled');
  });

  it('seeds the transparent writer from its entry sources', () => {
    const model = modelOf(guardedClose, 'this.status = value;', false);

    expect(suggestLifecycles(model)[0]?.fields.find((field) => field.field.name === 'status')?.transitions).toMatchObject({
      kind: 'seeded', entries: [{ method: 'close', from: [{ token: 'pending' }, { token: 'cancelled' }] }],
    });
  });

  it('withholds seeds from a guarded state-writing setter', () => {
    const model = modelOf("this.state = 'cancelled';", "if (this.status === 'paid') return; this.status = value;", false);

    expect(suggestLifecycles(model)[0]?.fields.find((field) => field.field.name === 'status')?.transitions).toEqual({ kind: 'withheld', methods: [{ method: 'close', reason: 'unknown-sources' }] });
  });

  it('keeps an unknown caller assignment uncertain for reachability', () => {
    const model = modelOf("this.state = unknownValue; this.title = 'x';");

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.ruleId === 'unreachable-state')).toEqual([]);
  });

  it('substitutes constructor setter arguments into initial values', () => {
    const project = inMemoryProject({ '/src/order.ts': `class Order {
      status: 'pending' | 'paid' | 'cancelled';
      set state(value: 'pending' | 'paid' | 'cancelled') { this.status = value; }
      constructor() { this.state = 'pending'; }
    }` });
    const cls = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

    expect(describeAssigned(initialValues(cls, resolvedField(cls, 'status')))).toEqual({ tokens: ['pending'], unresolved: false, mayWrite: false });
  });
});

describe('uncertain setter execution', () => {
  it('does not establish a field write from an uncalled nested function', () => {
    const model = modelOf("this.state = 'cancelled';", 'const write = () => { this.status = value; };');

    expect(describeAssigned(model.aggregates[0]!.methods[0]!.fields.get('status')!.sets)).toEqual({ tokens: [], unresolved: false, mayWrite: true });
  });
});
