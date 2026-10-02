import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/lib.d.ts': `
export declare abstract class LibRoot {
  protected abstract currentState(): string;
  get stateName(): string;
  assertActive(): void;
}
`,
  '/src/doc.ts': `
export type Status = 'open' | 'closed';
export abstract class Doc {
  protected status: Status = 'open';
  protected note = '';
  protected abstract assertEditable(): void;
  protected abstract label(): string;
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  editAssert(n: string): void { this.assertEditable(); this.note = n; }
  editLabel(n: string): void { const l = this.label(); if (l === 'closed') return; this.note = n; }
}
export class Memo extends Doc {
  protected assertEditable(): void { if (this.status === 'closed') throw new Error('x'); }
  protected label(): string { return this.status; }
}
`,
  '/src/account.ts': `
import { LibRoot } from '../types/lib';
export type Status = 'active' | 'closed';
export class Account extends LibRoot {
  private status: Status = 'active';
  private note = '';
  protected currentState(): string { return this.status; }
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  rename(n: string): void { this.assertActive(); this.note = n; }
  relabel(n: string): void { const s = this.stateName; if (s === 'closed') return; this.note = n; }
}
`,
  '/src/folder.ts': `
type Ctor = abstract new (...a: any[]) => { status: string };
export function Guarded<T extends Ctor>(B: T) {
  abstract class G extends B { assertOpen(): void { if (this.status === 'closed') throw new Error('x'); } }
  return G;
}
export abstract class Core { status: 'open' | 'closed' = 'open'; }
export class Folder extends Guarded(Core) {
  private note = '';
  close(): void { if (this.status === 'closed') throw new Error('x'); this.status = 'closed'; }
  edit(n: string): void { this.assertOpen(); this.note = n; }
}
`,
});

const classNamed = (path: string, name: string): ClassDeclaration =>
  project.getSourceFileOrThrow(path).getClassOrThrow(name);

const leaks = (target: ClassDeclaration) => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [
        { target, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined }], allowAfterTerminal: [] },
      ],
    },
    files: project.getSourceFiles(),
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method);
};

describe('members whose implementation may dispatch to project hooks', () => {
  it('reports no leak for an abstract project hook called as an assertion', () => {
    expect(leaks(classNamed('/src/doc.ts', 'Doc'))).not.toContain('editAssert');
  });

  it('reports no leak for an abstract project hook read through a local', () => {
    expect(leaks(classNamed('/src/doc.ts', 'Doc'))).not.toContain('editLabel');
  });

  it('reports no leak for a library assertion that may call a project hook', () => {
    expect(leaks(classNamed('/src/account.ts', 'Account'))).not.toContain('rename');
  });

  it('reports no leak for a library getter read through a local', () => {
    expect(leaks(classNamed('/src/account.ts', 'Account'))).not.toContain('relabel');
  });

  it('reports no leak for an assertion inherited from a project mixin', () => {
    expect(leaks(classNamed('/src/folder.ts', 'Folder'))).not.toContain('edit');
  });
});
