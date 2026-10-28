import { describe, expect, it } from 'vitest';
import { ClassDeclaration, CompilerOptions } from 'ts-morph';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';
import { methodOf } from '../../helpers/model';

type Files = Readonly<Record<string, string>>;

const ORDER_FILE = '/src/order.ts';

const aggregateClass = (files: Files, name: string, compilerOptions: CompilerOptions = {}): ClassDeclaration =>
  inMemoryProject(files, compilerOptions).getSourceFileOrThrow(ORDER_FILE).getClassOrThrow(name);

const reported = (files: Files, name = 'Order', compilerOptions: CompilerOptions = {}): readonly string[] => {
  const target = aggregateClass(files, name, compilerOptions);
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [{ target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] }],
    },
    files: target.getProject().getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return [
    ...model.problems.map((problem) => problem.code),
    ...lifecycleAnalyzer.check(model).map((finding) => `${finding.ruleId} ${methodOf(finding) ?? ''}`),
  ];
};

const orderWith = (members: string): Files => ({
  [ORDER_FILE]: `
export type Status = 'open' | 'closed';
export class Order {
  private status: Status = 'open';
  ${members}
}
`,
});

const CANCEL = `cancel(): void { this.status = 'closed'; }`;

describe('methods whose name is written', () => {
  it('does not judge a method that an own property assigned in the constructor shadows', () => {
    expect(reported(orderWith(`constructor() { this.cancel = (): void => {}; }\n${CANCEL}`))).toEqual([]);
  });

  it('judges a method whose name is never written', () => {
    expect(reported(orderWith(CANCEL))).toEqual(['terminal-state-leak cancel']);
  });

  it('judges a method when only a different name is written', () => {
    expect(reported(orderWith(`private note = '';\nconstructor() { this.note = 'new'; }\n${CANCEL}`))).toEqual(['terminal-state-leak cancel']);
  });

  it('does not judge a method replaced on the prototype', () => {
    const files = {
      ...orderWith(CANCEL),
      '/src/patch.ts': `
import { Order } from './order';
Order.prototype.cancel = function (): void {};
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('does not judge a method written through brackets in another file', () => {
    const files = {
      ...orderWith(CANCEL),
      '/test/order.spec.ts': `
import { Order } from '../src/order';
export const stub = (order: Order): void => { order['cancel'] = (): void => undefined; };
`,
    };

    expect(reported(files)).toEqual([]);
  });

  it('does not trace a caller into a method whose name is written', () => {
    const members = `private note = '';\nconstructor() { this.touch = (): void => {}; }\ntouch(): void { this.note = 'touched'; }\nclose(): void { this.touch(); this.status = 'closed'; }`;

    expect(reported(orderWith(members))).toEqual([]);
  });

  it('does not follow an assertion helper whose name is written', () => {
    const helper = `assertOpen(): void { if (this.status !== 'open') throw new Error('not open'); }`;
    const order = aggregateClass(orderWith(`constructor() { this.assertOpen = (): void => {}; }\n${helper}\nclose(): void { this.assertOpen(); this.status = 'closed'; }`), 'Order');

    expect(describeSources(methodSources(order.getMethodOrThrow('close'), resolvedField(order, 'status'), defaultScope(order)))).toBe('unknown');
  });
});
