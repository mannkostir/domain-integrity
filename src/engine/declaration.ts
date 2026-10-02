import { ClassDeclaration } from 'ts-morph';

export type DeclaredField = {
  readonly name: string;
  readonly terminal: readonly string[];
  readonly transitions: ReadonlyMap<string, readonly string[]> | undefined;
};

export type DeclaredLifecycle = {
  readonly target: ClassDeclaration;
  readonly fields: readonly DeclaredField[];
  readonly allowAfterTerminal: readonly string[];
};

export type DomainDeclaration = {
  readonly aggregateBaseClasses: readonly string[];
  readonly auditFields: readonly string[];
  readonly eventMethods: readonly string[];
  readonly lifecycles: readonly DeclaredLifecycle[];
};

export const DEFAULT_DECLARATION: DomainDeclaration = {
  aggregateBaseClasses: ['AggregateRoot', 'Entity'],
  auditFields: ['createdAt', 'updatedAt', 'version'],
  eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
  lifecycles: [],
};
