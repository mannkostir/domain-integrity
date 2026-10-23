import { ClassDeclaration } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { lifecycleAnalyzer } from '../../../src/analyzers/lifecycle/analyzer';
import { DEFAULT_DECLARATION } from '../../../src/engine/declaration';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/account.ts': `
class Opened {}
export class Account {
  private status: 'open' | 'closed' = 'open';
  private updatedAt = new Date();
  private readonly events: object[] = [];
  constructor(props: { status: 'open' | 'closed' }) { Object.assign(this, props); }
  get domainEvents(): ReadonlyArray<object> { return [...this.events]; }
  clearEvents(): void { this.events.length = 0; }
  touch(): void { this.updatedAt = new Date(); }
  open(): void { this.events.push(new Opened()); }
  reopen(): void { this.status = 'open'; }
  close(): void { if (this.status === 'closed') throw new Error('closed'); this.status = 'closed'; this.updatedAt = new Date(); }
}
`,
});

const account: ClassDeclaration = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('Account');

const leaks = (auditFields: readonly string[] = DEFAULT_DECLARATION.auditFields): readonly string[] => {
  const model = lifecycleAnalyzer.extract({
    declaration: {
      ...DEFAULT_DECLARATION,
      auditFields,
      lifecycles: [
        { target: account, fields: [{ name: 'status', terminal: ['closed'], transitions: undefined, allowAfterTerminal: [] }], allowAfterTerminal: [] },
      ],
    },
    files: project.getSourceFiles(),
    projectRoot: '/',
    repositoryRoot: '/',
  });
  return lifecycleAnalyzer
    .check(model)
    .filter((finding) => finding.ruleId === 'terminal-state-leak')
    .map((finding) => finding.details.method)
    .sort();
};

describe('methods that only keep books', () => {
  it('are not judged after a terminal state, while unguarded commands still are', () => {
    expect(leaks()).toEqual(['open', 'reopen']);
  });

  it('stay commands when an audit-listed field is a declared state field', () => {
    expect(leaks(['updatedAt', 'status'])).toContain('reopen');
  });
});
