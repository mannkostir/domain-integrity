import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/aggregate-root.ts': AGGREGATE_ROOT,
  '/types/lib.d.ts': `
export declare abstract class LibraryRoot {
  protected isReady(): boolean;
}
`,
  '/src/orders.ts': `
import { AggregateRoot } from './aggregate-root';
import { LibraryRoot } from '../types/lib';
import { MissingRoot } from '@missing/ddd';
export type Status = 'pending' | 'paid' | 'cancelled';
export abstract class BaseOrder extends AggregateRoot<object> {
  protected status: Status = 'pending';
  protected note = '';
  protected isOpen(): boolean { return this.status !== 'cancelled'; }
  protected abstract canEdit(): boolean;
  edit(n: string): void { if (!this.canEdit()) throw new Error('x'); this.note = n; }
}
export class Order extends BaseOrder {
  protected canEdit(): boolean { return this.status === 'pending'; }
  cancel(): void { if (!super.isOpen()) throw new Error('x'); this.status = 'cancelled'; }
  annotate(n: string): void { if (!this['isOpen']()) throw new Error('x'); this.note = n; }
  tag(n: string): void { if (this.status === 'cancelled') return; this.addEvent({}); this.note = this.note + n; }
}
export class LibraryOrder extends LibraryRoot {
  private status: Status = 'pending';
  private note = '';
  rename(n: string): void { if (!this.isReady()) return; this.note = n; }
}
export class UnresolvedOrder extends MissingRoot {
  private status: Status = 'pending';
  private note = '';
  rename(n: string): void { if (!this.canRename()) return; this.note = n; }
  tag(n: string): void { if (this.status === 'cancelled') return; this.note = this.note + n; }
}
`,
});

const file = project.getSourceFileOrThrow('/src/orders.ts');

const sourcesOf = (className: string, methodName: string) => {
  const cls = file.getClassOrThrow(className);
  return describeSources(methodSources(cls.getMethodOrThrow(methodName), resolvedField(cls, 'status'), defaultScope(cls)));
};

describe('guards that call members whose body cannot be traced', () => {
  it.each([
    ['Order', 'cancel'],
    ['Order', 'annotate'],
    ['BaseOrder', 'edit'],
    ['LibraryOrder', 'rename'],
    ['UnresolvedOrder', 'rename'],
  ])('%s.%s runs from unknown sources', (className, methodName) => {
    expect(sourcesOf(className, methodName)).toBe('unknown');
  });

  it('still reads a guard next to an event method from a project base class', () => {
    expect(sourcesOf('Order', 'tag')).toEqual(['paid', 'pending']);
  });

  it('still reads a guard next to a data field of a class with an unresolved base', () => {
    expect(sourcesOf('UnresolvedOrder', 'tag')).toEqual(['paid', 'pending']);
  });

  it('reports no leak for a guard through an element-access call', () => {
    const order = file.getClassOrThrow('Order');
    const model = lifecycleAnalyzer.extract({
      declaration: {
        ...DEFAULT_DECLARATION,
        lifecycles: [
          {
            target: order,
            fields: [{ name: 'status', terminal: ['cancelled'], transitions: undefined }],
            allowAfterTerminal: [],
          },
        ],
      },
      files: [file],
    });

    expect(lifecycleAnalyzer.check(model).filter((finding) => finding.checkId === 'terminal-state-leak')).toEqual([]);
  });
});
