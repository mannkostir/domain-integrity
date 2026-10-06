import { ClassDeclaration } from 'ts-morph';

export type DeclaredField = {
  readonly name: string;
  readonly terminal: readonly string[];
  readonly transitions: ReadonlyMap<string, readonly string[]> | undefined;
  readonly allowAfterTerminal: readonly string[];
};

export type DeclaredLifecycle = {
  readonly target: ClassDeclaration;
  readonly fields: readonly DeclaredField[];
  readonly allowAfterTerminal: readonly string[];
};

export type DeclaredSaga = {
  readonly target: ClassDeclaration;
  readonly outcomes: readonly (readonly [ClassDeclaration, ClassDeclaration])[];
};

export type DeclaredEvents = {
  readonly handlerDecorators: readonly string[];
  readonly registerMethods: readonly string[];
  readonly inProcess: readonly ClassDeclaration[];
  readonly sagas: readonly DeclaredSaga[];
};

export type DomainDeclaration = {
  readonly aggregateBaseClasses: readonly string[];
  readonly auditFields: readonly string[];
  readonly eventMethods: readonly string[];
  readonly inertEventMethods: readonly string[];
  readonly inertMembers: readonly string[];
  readonly lifecycles: readonly DeclaredLifecycle[];
  readonly events: DeclaredEvents;
};

export const DEFAULT_DECLARATION: DomainDeclaration = {
  aggregateBaseClasses: ['AggregateRoot', 'Entity'],
  auditFields: ['createdAt', 'updatedAt', 'version'],
  eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
  inertEventMethods: [],
  inertMembers: [],
  lifecycles: [],
  events: { handlerDecorators: ['EventsHandler', 'OnEvent'], registerMethods: ['register'], inProcess: [], sagas: [] },
};
