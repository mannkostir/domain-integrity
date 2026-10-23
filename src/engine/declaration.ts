import { ClassDeclaration } from 'ts-morph';
import { RuleId, RuleLevel } from '../finding';

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

export type DeclaredSuppression = {
  readonly rule: RuleId;
  readonly target: ClassDeclaration;
  readonly member: string | undefined;
  readonly reason: string;
  readonly line: number;
};

export type DomainDeclaration = {
  readonly aggregateBaseClasses: readonly string[];
  readonly auditFields: readonly string[];
  readonly eventMethods: readonly string[];
  readonly inertDecorators: readonly string[];
  readonly inertEventMethods: readonly string[];
  readonly inertMembers: readonly string[];
  readonly lifecycles: readonly DeclaredLifecycle[];
  readonly reportTestFileMutations: boolean;
  readonly events: DeclaredEvents;
  readonly rules: ReadonlyMap<RuleId, RuleLevel>;
  readonly suppressions: readonly DeclaredSuppression[];
};

export const DEFAULT_DECLARATION: DomainDeclaration = {
  aggregateBaseClasses: ['AggregateRoot', 'Entity'],
  auditFields: ['createdAt', 'updatedAt', 'version'],
  eventMethods: ['addEvent', 'addDomainEvent', 'apply'],
  inertDecorators: [],
  inertEventMethods: [],
  inertMembers: [],
  lifecycles: [],
  reportTestFileMutations: false,
  events: { handlerDecorators: ['EventsHandler', 'OnEvent'], registerMethods: ['register'], inProcess: [], sagas: [] },
  rules: new Map(),
  suppressions: [],
};

export type Deprecation = { readonly line: number; readonly old: string; readonly replacement: string };

export type ConfigReading = { readonly declaration: DomainDeclaration; readonly deprecations: readonly Deprecation[] };
