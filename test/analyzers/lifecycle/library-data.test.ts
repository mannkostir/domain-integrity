import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/types/ddd.d.ts': `
export declare abstract class LibraryRoot<P extends object> {
  protected props: P;
  readonly id: string;
  readonly snapshot: P;
  readonly loose: any;
  readonly check: () => boolean;
  readonly bag: Record<string, string>;
}
`,
  '/src/ticket.ts': `
import { LibraryRoot } from '../types/ddd';
export type Status = 'open' | 'closed';
export class Ticket extends LibraryRoot<{ status: Status; title: string }> {
  private note = '';
  renameById(n: string): void { this.note = n + this.id; }
  guardedBySnapshot(): void { if (this.snapshot.status === 'closed') return; this.note = 'x'; }
  viaAny(): void { this.note = String(this.loose); }
  guardedByLibraryFunction(): void { if (!this.check()) return; this.note = 'x'; }
  viaBag(): void { this.note = this.bag['x'] ?? ''; }
  close(): void { if (this.props.status === 'closed') throw new Error('x'); this.props.status = 'closed'; }
}
export class HookedTicket extends LibraryRoot<{ status: Status; title: string }> {
  private note = '';
  private canEdit!: () => boolean;
  constructor() { super(); this.canEdit = () => this.props.status === 'open'; }
  guardedByOwnFunction(): void { if (!this.canEdit()) return; this.note = 'x'; }
}
`,
});

const ticket = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('Ticket');

const sourcesOf = (methodName: string) =>
  describeSources(methodSources(ticket.getMethodOrThrow(methodName), resolvedField(ticket, 'status'), defaultScope(ticket)));

const leaks = () => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      lifecycles: [
        {
          target: ticket,
          fields: [{ name: 'status', terminal: ['closed'], transitions: undefined }],
          allowAfterTerminal: [],
        },
      ],
    },
    files: project.getSourceFiles(),
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.checkId === 'terminal-state-leak')
    .map((finding) => finding.method);
};

describe('data properties declared in a library', () => {
  it('leave a mutator judged when their type cannot carry the field', () => {
    expect(leaks()).toContain('renameById');
  });

  it('read the field when their type exposes it', () => {
    expect(sourcesOf('guardedBySnapshot')).toBe('unknown');
  });

  it('read the field when their type is any', () => {
    expect(sourcesOf('viaAny')).toBe('unknown');
  });

  it('read the field when their type is callable', () => {
    expect(sourcesOf('guardedByLibraryFunction')).toBe('unknown');
  });

  it('read the field when their type has an index signature', () => {
    expect(sourcesOf('viaBag')).toBe('unknown');
  });
});

describe('function-typed properties declared in the project', () => {
  it('read the field when invoked in a guard of an aggregate that leaks this', () => {
    const hooked = project.getSourceFileOrThrow('/src/ticket.ts').getClassOrThrow('HookedTicket');
    expect(
      describeSources(
        methodSources(hooked.getMethodOrThrow('guardedByOwnFunction'), resolvedField(hooked, 'status'), defaultScope(hooked)),
      ),
    ).toBe('unknown');
  });
});
