import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const ORDER = `
import { AggregateRoot } from './aggregate-root';
export type Status = 'pending' | 'paid' | 'cancelled';
class Renamed { constructor(readonly order: Order) {} }
export class Order extends AggregateRoot<object> {
  private status: Status = 'pending';
  private note = '';
  pay(): void { if (this.status !== 'pending') throw new Error('x'); this.status = 'paid'; }
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; }
  rename(n: string): this { if (this.status === 'cancelled') throw new Error('x'); this.note = n; return this; }
  describe(n: string): void { if (this.status === 'cancelled') throw new Error('x'); this.note = n; this.addEvent(new Renamed(this)); }
  toJSON(): object { return { ...this }; }
}
`;

const project = inMemoryProject({ '/src/aggregate-root.ts': AGGREGATE_ROOT, '/src/order.ts': ORDER });
const order = project.getSourceFileOrThrow('/src/order.ts').getClassOrThrow('Order');

const modelWith = (declared: boolean) =>
  lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: declared
        ? [
            {
              target: order,
              fields: [
                {
                  name: 'status',
                  terminal: ['cancelled'],
                  transitions: new Map([
                    ['pay', ['pending']],
                    ['cancel', ['pending', 'paid']],
                  ]),
                },
              ],
              allowAfterTerminal: [],
            },
          ]
        : [],
    },
    files: project.getSourceFiles(),
  });

describe('methods that let this escape without writing the state field', () => {
  it('produce no transition drift', () => {
    expect(lifecycleAnalyzer.check(modelWith(true)).filter((finding) => finding.checkId === 'transition-drift')).toEqual([]);
  });

  it('are left out of the summary transitions', () => {
    expect(lifecycleAnalyzer.summarize(modelWith(true), '/')).not.toContain('(computed)');
  });

  it('keep the terminal suggestion', () => {
    const [suggestion] = lifecycleAnalyzer.suggest(modelWith(false));

    expect(suggestion?.fields.map((field) => field.terminal.map((value) => value.token))).toEqual([['cancelled']]);
  });
});
