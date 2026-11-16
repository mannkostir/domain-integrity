import { describe, expect, it } from 'vitest';
import { terminalStateLeak } from '../../../src/analyzers/lifecycle/checks/terminal-state-leak';
import { extractLifecycles } from '../../../src/analyzers/lifecycle/extract';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

type Operand = readonly [expression: string, strict: readonly string[], loose: readonly string[] | 'unknown'];

const booleanOperands: readonly Operand[] = [
  ["'false'", [], 'unknown'],
  ["'true'", [], 'unknown'],
  ["'unset'", [], 'unknown'],
  ['false', ['false'], ['false']],
  ['true', ['true'], ['true']],
];
const stringOperands: readonly Operand[] = [
  ['false', [], 'unknown'],
  ['true', [], 'unknown'],
  ["'false'", ['false'], ['false']],
  ["'true'", ['true'], ['true']],
];
const nullOperands: readonly Operand[] = [
  ['null', ['unset'], ['unset']],
  ['undefined', [], ['unset']],
];
const undefinedOperands: readonly Operand[] = [
  ['null', [], ['unset']],
  ['undefined', ['unset'], ['unset']],
];
const fields = [
  ['BooleanNull', 'boolean | null', 'null', [...booleanOperands, ...nullOperands]],
  ['BooleanUndefined', 'boolean | undefined', 'undefined', [...booleanOperands, ...undefinedOperands]],
  ['Strings', "'false' | 'true' | null", 'null', [...stringOperands, ...nullOperands]],
  ['Enums', 'Status | null', 'null', [...stringOperands, ...nullOperands]],
] as const;

const fieldRead = '(this as { state: unknown }).state';
const guardBodies = (operand: string): readonly string[] => [
  `if (${fieldRead} !== ${operand}) return; this.label = 'x';`,
  `if (${fieldRead} === ${operand}) return; this.label = 'x';`,
  `if (${fieldRead} != ${operand}) return; this.label = 'x';`,
  `if (${fieldRead} == ${operand}) return; this.label = 'x';`,
  `if (!([${operand}] as readonly unknown[]).includes(this.state)) return; this.label = 'x';`,
  `switch (${fieldRead}) { case ${operand}: this.label = 'x'; break; default: break; }`,
];

const project = inMemoryProject({
  '/samples.ts': `
export class AggregateRoot {}
export enum Status { off = 'false', on = 'true' }
${fields.map(([name, type, initial, operands]) => `
export class ${name} extends AggregateRoot {
  state: ${type} = ${initial};
  label = '';
  ${operands.flatMap(([operand], operandIndex) => guardBodies(operand).map((body, consumerIndex) => `guard${operandIndex}_${consumerIndex}(): void { ${body} }`)).join('\n')}
}`).join('\n')}
`,
});

const clsNamed = (name: string) => project.getSourceFileOrThrow('/samples.ts').getClassOrThrow(name);
const consumers = ['strict equality', 'strict inequality', 'loose equality', 'loose inequality', 'includes', 'switch'];
const complement = (matching: readonly string[]): readonly string[] => ['false', 'true', 'unset'].filter((token) => !matching.includes(token));

describe('Boolean token identity', () => {
  it('uses source fixtures with zero TypeScript diagnostics', () => {
    expect(project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
  });

  for (const [name, , , operands] of fields) {
    describe(name, () => {
      const cls = clsNamed(name);
      const scope = defaultScope(cls);

      for (const [operandIndex, [operand, strict, loose]] of operands.entries()) {
        const expected = [strict, complement(strict), loose, loose === 'unknown' ? loose : complement(loose), strict, strict];

        for (const [consumerIndex, consumer] of consumers.entries()) {
          it(`uses the actual type of ${operand} for ${consumer}`, () => {
            const sources = methodSources(cls.getMethodOrThrow(`guard${operandIndex}_${consumerIndex}`), resolvedField(cls, 'state'), scope);

            expect(describeSources(sources)).toEqual(expected[consumerIndex]);
          });
        }
      }
    });
  }

  it.each(['BooleanNull', 'BooleanUndefined'])('reports no string-membership leaks for %s', (name) => {
    const cls = clsNamed(name);
    const model = extractLifecycles({
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [{ target: cls, fields: [{ name: 'state', terminal: ['false', 'true', 'unset'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
      },
      files: project.getSourceFiles(),
      projectRoot: '/',
      repositoryRoot: '/',
    });
    const stringMembershipMethods = new Set(['guard0_4', 'guard1_4', 'guard2_4']);
    const findings = model.aggregates.filter((aggregate) => aggregate.name === name).flatMap(terminalStateLeak);

    expect(findings.filter((finding) => stringMembershipMethods.has(finding.details.method))).toEqual([]);
  });
});
