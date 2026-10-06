import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/orders.ts': `
export abstract class AggregateRoot { protected addEvent(e: object): void { void e; } }
export type Status = 'pending' | 'paid' | 'cancelled';
export abstract class OrderBase extends AggregateRoot {
  protected status: Status = 'pending';
  protected note = '';
  protected isOpen(): boolean { return this.status !== 'cancelled'; }
  protected get open(): boolean { return this.status !== 'cancelled'; }
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; }
}
export abstract class MidOrder extends OrderBase {
  protected isOpen(): boolean { return true; }
  protected get open(): boolean { return true; }
  edit(n: string): void { if (!super.isOpen()) throw new Error('x'); this.note = n; }
  retitle(n: string): void { if (!super.open) throw new Error('x'); this.note = n; }
}
export class Order extends MidOrder {}
`,
});

const order = project.getSourceFileOrThrow('/src/orders.ts').getClassOrThrow('Order');
const midOrder = project.getSourceFileOrThrow('/src/orders.ts').getClassOrThrow('MidOrder');

const sourcesOf = (methodName: string) =>
  describeSources(methodSources(midOrder.getMethodOrThrow(methodName), resolvedField(order, 'status'), defaultScope(order)));

describe('super inside a method inherited by the analysed aggregate', () => {
  it('resolves a super getter from the parent of the declaring class', () => {
    expect(sourcesOf('retitle')).toEqual(['paid', 'pending']);
  });

  it('reports no leak for a guard through a super method of the declaring class', () => {
    const model = lifecycleAnalyzer.extract({
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [
          {
            target: order,
            fields: [{ name: 'status', terminal: ['cancelled'], transitions: undefined, allowAfterTerminal: [] }],
            allowAfterTerminal: [],
          },
        ],
      },
      files: project.getSourceFiles(),
      root: '/',
    });

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.checkId === 'terminal-state-leak')).toEqual([]);
  });
});
