import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/ddd.d.ts': `
export declare abstract class Entity<P extends object> {
  protected readonly props: P;
  get id(): string;
  get active(): boolean;
  get label(): string;
  readonly loose: any;
  clearDomainEvents(): void;
}
`,
  '/src/todo.ts': `
import { Entity } from '../types/ddd';
export type Status = 'open' | 'closed';
export class Todo extends Entity<{ status: Status }> {
  private note = '';
  renameById(n: string): void { this.note = n + this.id; }
  renameByIndex(n: string): void { this.note = n + this['id']; }
  commit(): void { this.note = ''; this.clearDomainEvents(); }
  resetBySuper(): void { this.note = ''; super.clearDomainEvents(); }
  flush(): void { this.clearDomainEvents(); }
  viaAny(): void { this.note = String(this.loose); }
  guardedByFlag(): void { if (!this.active) return; this.note = 'x'; }
  peek(): void { this.note = this.props.status; }
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
}
export class OverridingTodo extends Entity<{ status: Status }> {
  private note = '';
  override get label(): string { return this.props.status; }
  relabel(): void { this.note = this.label; }
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
}
export class LeakyTodo extends Entity<{ status: Status }> {
  private note = '';
  private policy: { ok(): boolean } = { ok: () => this.props.status === 'open' };
  viaPolicy(): void { this.note = String(this.policy); }
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
}
`,
  '/src/unresolved-todo.ts': `
import { Entity } from 'not-installed-ddd';
export type Status = 'open' | 'closed';
export class UnresolvedTodo extends Entity {
  private status: Status = 'open';
  private note = '';
  renameById(n: string): void { this.note = n + this.id; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
}
`,
});

const classNamed = (path: string, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow(path).getClassOrThrow(name);

const todo = classNamed('/src/todo.ts', 'Todo');

const leaks = (target: ClassDeclaration, inertMembers: readonly string[]) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      inertMembers,
      lifecycles: [
        { target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined }], allowAfterTerminal: [] },
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

describe('inertMembers', () => {
  it('leaves unlisted library members silencing the methods that use them', () => {
    expect(leaks(todo, [])).toEqual([]);
  });

  it('lets a listed library getter be read without silencing the method', () => {
    expect(leaks(todo, ['id'])).toEqual(['renameById', 'renameByIndex']);
  });

  it('lets a listed library method be called, directly or through super, without silencing the method', () => {
    expect(leaks(todo, ['clearDomainEvents'])).toEqual(['commit', 'resetBySuper']);
  });

  it('does not make a method that only calls a listed method count as changing the aggregate', () => {
    expect(leaks(todo, ['clearDomainEvents'])).not.toContain('flush');
  });

  it('lets listed library data be read without silencing the method', () => {
    expect(leaks(todo, ['loose'])).toEqual(['viaAny']);
  });

  it('reads a guard through a listed library getter as no guard', () => {
    expect(leaks(todo, ['active'])).toEqual(['guardedByFlag']);
  });

  it('keeps reads of the state field itself when its name is listed', () => {
    expect(leaks(todo, ['status'])).toEqual([]);
  });

  it('applies to members of a base class that cannot be resolved', () => {
    expect(leaks(classNamed('/src/unresolved-todo.ts', 'UnresolvedTodo'), ['id'])).toEqual(['renameById']);
  });

  it('still traces a project override of a listed name', () => {
    expect(leaks(classNamed('/src/todo.ts', 'OverridingTodo'), ['label'])).toEqual([]);
  });

  it('still counts a listed project data field in an aggregate that leaks this', () => {
    expect(leaks(classNamed('/src/todo.ts', 'LeakyTodo'), ['policy'])).toEqual([]);
  });
});
