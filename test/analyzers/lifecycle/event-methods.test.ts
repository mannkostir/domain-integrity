import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/cqrs.d.ts': `
export declare class AggregateRoot { apply(event: object): void; }
`,
  '/src/library-order.ts': `
import { AggregateRoot } from '../types/cqrs';
export type Status = 'pending' | 'paid' | 'cancelled';
export class LibraryOrder extends AggregateRoot {
  private status: Status = 'pending';
  private note = '';
  pay(): void { if (this.status !== 'pending') throw new Error('x'); this.status = 'paid'; this.apply({ type: 'paid' }); }
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; this.apply({ type: 'cancelled' }); }
  renameWithEvent(n: string): void { this.note = n; this.apply({ type: 'renamed' }); }
  renamePlain(n: string): void { this.note = n; }
  eventOnly(): void { this.apply({ type: 'touched' }); }
  snapshot(): void { this.note = 'x'; this.apply({ status: this.status }); }
}
`,
  '/src/unresolved-order.ts': `
import { AggregateRoot } from 'not-installed-cqrs';
export type Status = 'pending' | 'paid' | 'cancelled';
export class UnresolvedOrder extends AggregateRoot {
  private status: Status = 'pending';
  private note = '';
  pay(): void { if (this.status !== 'pending') throw new Error('x'); this.status = 'paid'; }
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; }
  renameWithEvent(n: string): void { this.note = n; this.apply({ type: 'renamed' }); }
  publishing(n: string): void { this.note = n; this.publish({ type: 'renamed' }); }
}
`,
  '/src/project-order.ts': `
export type Status = 'pending' | 'paid' | 'cancelled';
export abstract class AuditedRoot {
  protected status: Status = 'pending';
  protected addEvent(event: object): void { void event; void this.status; }
}
export class ProjectOrder extends AuditedRoot {
  private note = '';
  cancel(): void { if (this.status === 'cancelled') throw new Error('x'); this.status = 'cancelled'; }
  renameWithEvent(n: string): void { this.note = n; this.addEvent({ type: 'renamed' }); }
}
`,
  '/src/mixin-todo.ts': `
export type Status = 'open' | 'cancelled';
export class Core { protected props: { status: Status } = { status: 'open' }; }
type Constructor<T> = new (...args: never[]) => T;
export const WithEvents = <B extends Constructor<Core>>(Base: B) =>
  class extends Base {
    private events: object[] = [];
    addEvent(event: object): void {
      if (this.props.status === 'cancelled') throw new Error('x');
      this.events.push(event);
    }
  };
export class MixinTodo extends WithEvents(Core) {
  private note = '';
  rename(n: string): void { this.addEvent({ type: 'renamed' }); this.note = n; }
  cancel(): void { if (this.props.status === 'cancelled') throw new Error('x'); this.props.status = 'cancelled'; }
}
`,
});

const classNamed = (path: string, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow(path).getClassOrThrow(name);

const leaks = (target: ClassDeclaration, eventMethods: readonly string[] = DEFAULT_DECLARATION.eventMethods) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      eventMethods,
      lifecycles: [
        { target, fields: [{ name: 'status', terminal: ['cancelled'], transitions: undefined }], allowAfterTerminal: [] },
      ],
    },
    files: project.getSourceFiles(),
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method)
    .sort();
};

describe('configured event methods without a body in the project', () => {
  it('do not hide leaks when declared only in a declaration file', () => {
    expect(leaks(classNamed('/src/library-order.ts', 'LibraryOrder'))).toEqual([
      'eventOnly',
      'renamePlain',
      'renameWithEvent',
    ]);
  });

  it('do not hide leaks when the base class cannot be resolved', () => {
    expect(leaks(classNamed('/src/unresolved-order.ts', 'UnresolvedOrder'))).toEqual(['renameWithEvent']);
  });

  it('follow the configured names rather than the defaults', () => {
    expect(leaks(classNamed('/src/unresolved-order.ts', 'UnresolvedOrder'), ['publish'])).toEqual(['publishing']);
  });

  it('are still traced when the project declares their body', () => {
    expect(leaks(classNamed('/src/project-order.ts', 'ProjectOrder'))).toEqual([]);
  });

  it('do not report callers when a project mixin declares them', () => {
    expect(leaks(classNamed('/src/mixin-todo.ts', 'MixinTodo'))).toEqual([]);
  });
});
