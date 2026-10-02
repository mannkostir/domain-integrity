import { describe, expect, it } from 'vitest';
import { methodSources } from '../../../src/analyzers/lifecycle/guards';
import { defaultScope, describeSources, resolvedField } from '../../helpers/describe';
import { inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/base.ts': `
export abstract class AggregateRoot<P> { constructor(protected props: P) {} protected addEvent(e: unknown): void { void e; } }
`,
  '/src/account.ts': `
import { AggregateRoot } from './base';
type Props = { closedAt?: Date | null; balance: number; archived: boolean };
export class Account extends AggregateRoot<Props> {
  audit(): void { const run = function (this: { closedAt?: Date }) { if (this.closedAt) throw new Error('x'); }; run.call({}); this.addEvent('audit'); }
  auditDeclared(): void { function run(this: { closedAt?: Date }) { if (this.closedAt) throw new Error('x'); } run.call({}); this.props.balance += 0; }
  auditNestedArrow(): void { const run = function (this: { closedAt?: Date }) { const read = () => this.closedAt; read(); }; run.call({}); this.props.balance += 0; }
  auditArrow(): void { const run = () => { if (this.canAudit()) throw new Error('x'); }; run(); this.props.balance += 0; }
}
`,
});

const account = project.getSourceFileOrThrow('/src/account.ts').getClassOrThrow('Account');

const sourcesOf = (methodName: string) =>
  describeSources(
    methodSources(account.getMethodOrThrow(methodName), resolvedField(account, 'archived'), defaultScope(account)),
  );

describe('this inside a nested function', () => {
  it.each(['audit', 'auditDeclared', 'auditNestedArrow'])('%s does not read the aggregate through a foreign this', (method) => {
    expect(sourcesOf(method)).toEqual(['false', 'true']);
  });

  it('still treats this inside an arrow function as the aggregate', () => {
    expect(sourcesOf('auditArrow')).toBe('unknown');
  });
});
