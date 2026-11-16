import { describe, expect, it } from 'vitest';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const guards = [
  ['strictEqual', 'if (this.state === undefined) return;'],
  ['looseEqual', 'if (this.state == undefined) return;'],
  ['strictUnequal', 'if (this.state !== undefined) return;'],
  ['looseUnequal', 'if (this.state != undefined) return;'],
  ['switchCase', 'switch (this.state) { case undefined: return; }'],
  ['includesElement', 'if (([undefined] as readonly unknown[]).includes(this.state)) return;'],
] as const;

const operands: readonly (readonly [string, readonly (readonly string[] | 'unknown')[]])[] = [
  ['true', [['false', 'unset'], ['false', 'unset'], ['true'], ['true'], ['false', 'unset'], ['false', 'unset']]],
  ['false', [['true', 'unset'], ['true', 'unset'], ['false'], ['false'], ['true', 'unset'], ['true', 'unset']]],
  ['undefined', [['false', 'true', 'unset'], ['false', 'true'], [], ['unset'], ['false', 'true', 'unset'], ['false', 'true', 'unset']]],
  ['boolean', ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']],
  ['true | undefined', ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']],
  ['unknown', ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']],
  ['any', ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']],
];

const project = inMemoryProject({
  '/samples.ts': `
export class AggregateRoot {}
${operands.map(([type], index) => `
export class Shadow${index} extends AggregateRoot {
  state: boolean | null = null;
  label = '';
  ${guards.map(([name, guard]) => `${name}(undefined: ${type}): void { ${guard} this.label = 'x'; }`).join('\n')}
}`).join('\n')}
export enum Status { off = 'false', on = 'true' }
export class Strings extends AggregateRoot {
  state: 'false' | 'true' | null = null;
  label = '';
  falsyExit(): void { if (!this.state) return; this.label = 'x'; }
  truthyExit(): void { if (this.state) return; this.label = 'x'; }
}
export class Enums extends AggregateRoot {
  state: Status | null = null;
  label = '';
  falsyExit(): void { if (!this.state) return; this.label = 'x'; }
  truthyExit(): void { if (this.state) return; this.label = 'x'; }
}
`,
});

const clsNamed = (name: string) => project.getSourceFileOrThrow('/samples.ts').getClassOrThrow(name);

const leaksFor = (name: string, terminal: string) => {
  const cls = clsNamed(name);
  const model = extractLifecycles({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{ target: cls, fields: [{ name: 'state', terminal: [terminal], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: project.getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return model.aggregates.filter((aggregate) => aggregate.name === name).flatMap(terminalStateLeak).map((finding) => finding.details.method).sort();
};

describe('nullable boolean review regressions', () => {
  it('uses fixtures accepted by TypeScript', () => {
    expect(project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
  });

  for (const [index, [type, expected]] of operands.entries()) {
    describe(`parameter named undefined typed ${type}`, () => {
      const cls = clsNamed(`Shadow${index}`);
      const scope = defaultScope(cls);

      for (const [guardIndex, [name]] of guards.entries()) {
        it(`uses the operand meaning in ${name}`, () => {
          const sources = methodSources(cls.getMethodOrThrow(name), resolvedField(cls, 'state'), scope);

          expect(describeSources(sources)).toEqual(expected[guardIndex]);
        });
      }
    });
  }

  it('reports only methods that admit true when a parameter named undefined means true', () => {
    expect(leaksFor('Shadow0', 'true')).toEqual(['looseUnequal', 'strictUnequal']);
  });

  it('reports only methods that admit false when a parameter named undefined means false', () => {
    expect(leaksFor('Shadow1', 'false')).toEqual(['looseUnequal', 'strictUnequal']);
  });

  it('reports no leak for guards whose shadowed operand is uncertain', () => {
    expect(operands.slice(3).flatMap((_, index) => leaksFor(`Shadow${index + 3}`, 'true'))).toEqual([]);
  });

  for (const name of ['Strings', 'Enums']) {
    describe(`truthy false text in ${name}`, () => {
      const cls = clsNamed(name);
      const scope = defaultScope(cls);

      it('admits both nonempty string values after a falsy exit', () => {
        expect(describeSources(methodSources(cls.getMethodOrThrow('falsyExit'), resolvedField(cls, 'state'), scope))).toEqual(['false', 'true']);
      });

      it('admits only unset after a truthy exit', () => {
        expect(describeSources(methodSources(cls.getMethodOrThrow('truthyExit'), resolvedField(cls, 'state'), scope))).toEqual(['unset']);
      });

      it('reports the terminal string value false when a falsy exit lets it through', () => {
        expect(leaksFor(name, 'false')).toEqual(['falsyExit']);
      });
    });
  }
});
