import { describe, expect, it } from 'vitest';
import { discoverAggregates } from '../../../src/analyzers/lifecycle/discover';
import { AGGREGATE_ROOT, inMemoryProject } from '../../helpers/in-memory';

const project = inMemoryProject({
  '/src/base.ts': `${AGGREGATE_ROOT}\nexport abstract class Versioned<P extends object> extends AggregateRoot<P> {}\n`,
  '/src/aggregates.ts': `
import { AggregateRoot, Versioned } from './base';
export class Direct extends AggregateRoot {}
export class Indirect extends Versioned<{ a: number }> {}
export class Plain {}
`,
  '/src/external.ts': `
import { AggregateRoot } from '@unresolved/ddd';
export class External extends AggregateRoot {}
`,
});

const files = project.getSourceFiles();
const names = (classes: { getName(): string | undefined }[]) => classes.map((cls) => cls.getName()).sort();

const interfaceProject = inMemoryProject({
  '/src/account.ts': `
export interface Account { readonly id: string }
export interface Owned extends Account {}
export interface Audited extends Owned {}
export interface Printable {}
export interface Loop extends Knot {}
export interface Knot extends Loop {}
export class Entity {}
export interface Repo<T> { find(id: T): void }
`,
  '/src/accounts.ts': `
import { Account, Audited, Entity, Loop, Printable } from './account';
export class DirectAccount implements Account { readonly id = 'a'; }
export class AuditedAccount implements Audited { readonly id = 'b'; }
export abstract class BaseAccount implements Account { readonly id = 'c'; }
export class SavingsAccount extends BaseAccount {}
export class Report implements Printable {}
export class Tangled implements Loop {}
export class HybridAccount extends Entity implements Printable, Account { readonly id = 'd'; }
`,
  '/src/aliased.ts': `
import { Account, Owned } from './account';
type AccountAlias = Account;
type OwnedAlias = Owned;
export class AliasedAccount implements AccountAlias { readonly id = 'e'; }
export class AliasedOwned implements OwnedAlias { readonly id = 'f'; }
`,
  '/src/renamed.ts': `
import { Account as Acc } from './account';
export class RenamedAccount implements Acc { readonly id = 'g'; }
`,
  '/src/qualified.ts': `
import * as ns from './account';
export class QualifiedAccount implements ns.Account { readonly id = 'h'; }
`,
  '/src/repos.ts': `
import { Repo } from './account';
export class NumberRepo implements Repo<number> { find(): void {} }
`,
  '/src/external-account.ts': `
import { Account } from '@unresolved/accounts';
export class ExternalAccount implements Account {}
`,
});

const discoverByAccountInterface = (): readonly (string | undefined)[] =>
  names(discoverAggregates(interfaceProject.getSourceFiles(), ['Account'], []));

const DIAMOND_DEPTH = 30;

const diamondLevel = (level: number): string =>
  `interface D${level} extends L${level}, R${level} {}\ninterface L${level} extends D${level + 1} {}\ninterface R${level} extends D${level + 1} {}\n`;

const diamondSource = (depth: number): string =>
  `${Array.from({ length: depth }, (_, level) => diamondLevel(level)).join('')}interface D${depth} {}\nexport class Deep implements D0 {}\n`;

const diamondProject = inMemoryProject({
  '/src/diamond.ts': diamondSource(DIAMOND_DEPTH),
});

describe('discoverAggregates', () => {
  it('finds direct, transitive and unresolved-base subclasses but not abstract or plain classes', () => {
    expect(names(discoverAggregates(files, ['AggregateRoot'], []))).toEqual(['Direct', 'External', 'Indirect']);
  });

  it('includes declared classes that extend no known base', () => {
    const plain = project.getSourceFileOrThrow('/src/aggregates.ts').getClassOrThrow('Plain');

    expect(names(discoverAggregates(files, ['AggregateRoot'], [plain]))).toEqual(['Direct', 'External', 'Indirect', 'Plain']);
  });

  it('finds a class that directly implements a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('DirectAccount');
  });

  it('finds a class that implements an unresolved named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('ExternalAccount');
  });

  it('finds a class whose implemented interface transitively extends a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('AuditedAccount');
  });

  it('finds a subclass of an abstract class that implements a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('SavingsAccount');
  });

  it('finds a class that both extends a plain class and implements a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('HybridAccount');
  });

  it('skips an abstract class that implements a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).not.toContain('BaseAccount');
  });

  it('skips a class that implements an unrelated interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).not.toContain('Report');
  });

  it('skips a class whose implemented interfaces extend each other in a cycle', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).not.toContain('Tangled');
  });

  it('finds a class that implements a type alias of a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('AliasedAccount');
  });

  it('finds a class that implements a type alias of an interface extending a named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('AliasedOwned');
  });

  it('finds a class that implements a named interface imported under another name', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('RenamedAccount');
  });

  it('finds a class that implements a namespace-qualified named interface', () => {
    const discovered = discoverByAccountInterface();

    expect(discovered).toContain('QualifiedAccount');
  });

  it('finds a class that implements a named generic interface with type arguments', () => {
    expect(names(discoverAggregates(interfaceProject.getSourceFiles(), ['Repo'], []))).toEqual(['NumberRepo']);
  });

  it('finds nothing in a deep diamond-shaped hierarchy of unrelated interfaces without hanging', () => {
    expect(names(discoverAggregates(diamondProject.getSourceFiles(), ['Account'], []))).toEqual([]);
  });
});
