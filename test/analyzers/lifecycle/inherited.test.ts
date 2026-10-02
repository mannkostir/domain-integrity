import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION, DeclaredField } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': `
export abstract class AggregateRoot {
  private events: object[] = [];
  clearEvents(): void { this.events = []; }
}
`,
  '/src/orders.ts': `
import { AggregateRoot } from './aggregate-root';
export type Status = 'pending' | 'paid' | 'cancelled';
export abstract class BaseOrder extends AggregateRoot {
  protected status: Status = 'pending';
  protected note = '';
  pay(): void { if (this.status !== 'pending') throw new Error('x'); this.status = 'paid'; }
  annotate(n: string): void { this.note = n; }
  rename(n: string): void { this.note = n; }
}
export class Order extends BaseOrder {
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; }
  rename(n: string): void { if (this.status === 'cancelled') throw new Error('x'); this.note = n; }
}
`,
});

const order = project.getSourceFileOrThrow('/src/orders.ts').getClassOrThrow('Order');

const analyse = (field: DeclaredField) => {
  const model = lifecycleAnalyzer.extract({
    declaration: { ...DEFAULT_DECLARATION, lifecycles: [{ target: order, fields: [field], allowAfterTerminal: [] }] },
    files: project.getSourceFiles(),
  });
  return {
    problems: model.problems,
    findings: lifecycleAnalyzer.check(model).map((finding) => `${finding.checkId} ${finding.method} ${finding.subject}`),
  };
};

describe('methods inherited from a project base class', () => {
  it('are accepted and checked when transitions name them', () => {
    expect(
      analyse({
        name: 'status',
        terminal: [],
        transitions: new Map([
          ['pay', ['pending', 'paid']],
          ['cancel', ['pending', 'paid']],
        ]),
      }),
    ).toEqual({ problems: [], findings: ['transition-drift pay missing'] });
  });

  it('are judged for terminal-state leaks on the subclass, with subclass overrides taking precedence', () => {
    expect(analyse({ name: 'status', terminal: ['cancelled'], transitions: undefined })).toEqual({
      problems: [],
      findings: ['terminal-state-leak annotate cancelled'],
    });
  });
});
