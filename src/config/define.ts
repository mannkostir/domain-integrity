export type StateToken = string | number | boolean;

export type EventClass = { readonly prototype: object };

export type SagaSpec = { readonly outcomes: readonly (readonly [EventClass, EventClass])[] };

export type SagaDeclaration = { readonly kind: 'saga'; readonly target: object; readonly spec: SagaSpec };

export type AggregatesConfig = {
  readonly baseClasses?: readonly string[];
  readonly auditFields?: readonly string[];
};

export type EventsConfig = {
  readonly raiseMethods?: readonly string[];
  readonly handlerDecorators?: readonly string[];
  readonly registerMethods?: readonly string[];
  readonly inProcess?: readonly EventClass[];
  readonly sagas?: readonly SagaDeclaration[];
};

export type InertConfig = {
  readonly decorators?: readonly string[];
  readonly members?: readonly string[];
  readonly raiseMethods?: readonly string[];
};

export type TransitionSpec = { readonly from: readonly StateToken[] };

type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
  string;

export type FieldSpec<T> = {
  readonly terminal: StateToken | readonly StateToken[];
  readonly transitions?: Partial<Record<MethodName<T>, TransitionSpec | readonly StateToken[]>>;
  readonly allowAfterTerminal?: readonly MethodName<T>[];
};

export type LifecycleSpec<T> = {
  readonly states: Readonly<Record<string, FieldSpec<T>>>;
  readonly allowAfterTerminal?: readonly MethodName<T>[];
};

export type LifecycleDeclaration = {
  readonly kind: 'lifecycle';
  readonly target: object;
  readonly spec: object;
};

export type RuleLevel = 'off' | 'warning' | 'error';

type MethodRule = 'terminal-state-leak' | 'transition-drift' | 'transition-missing';

type MemberRule =
  | 'unreachable-state'
  | 'outside-mutation'
  | 'undispatched-events'
  | 'dead-handler'
  | 'handler-payload-mismatch';

type ClassRule = 'unhandled-event' | 'saga-missing-failure-path';

export type RuleName = MethodRule | MemberRule | ClassRule;

export type RuleSetting = RuleLevel | { readonly level?: RuleLevel };

export type OutsideMutationSetting = RuleLevel | { readonly level?: RuleLevel; readonly testFiles?: boolean };

export type RulesConfig = {
  readonly [R in RuleName]?: R extends 'outside-mutation' ? OutsideMutationSetting : RuleSetting;
};

export type SuppressionSpec<T> =
  | { readonly rule: MethodRule; readonly member?: MethodName<T>; readonly reason: string }
  | { readonly rule: MemberRule; readonly member?: string; readonly reason: string }
  | { readonly rule: ClassRule; readonly reason: string };

export type SuppressionDeclaration = {
  readonly kind: 'suppression';
  readonly target: object;
  readonly spec: object;
};

export type DomainConfig = {
  readonly aggregates?: AggregatesConfig;
  readonly lifecycles?: readonly LifecycleDeclaration[];
  readonly events?: EventsConfig;
  readonly inert?: InertConfig;
  readonly rules?: RulesConfig;
  readonly suppressions?: readonly SuppressionDeclaration[];
  /** @deprecated Use aggregates.baseClasses. */
  readonly aggregateBaseClasses?: readonly string[];
  /** @deprecated Use aggregates.auditFields. */
  readonly auditFields?: readonly string[];
  /** @deprecated Use events.raiseMethods. */
  readonly eventMethods?: readonly string[];
  /** @deprecated Use rules['outside-mutation'].testFiles. */
  readonly reportTestFileMutations?: boolean;
  /** @deprecated Use inert.decorators. */
  readonly inertDecorators?: readonly string[];
  /** @deprecated Use inert.raiseMethods. */
  readonly inertEventMethods?: readonly string[];
  /** @deprecated Use inert.members. */
  readonly inertMembers?: readonly string[];
};

export const lifecycle = <T extends object>(
  target: { readonly prototype: T },
  spec: LifecycleSpec<T>,
): LifecycleDeclaration => ({ kind: 'lifecycle', target, spec });

export const saga = <T extends object>(
  target: { readonly prototype: T },
  spec: SagaSpec,
): SagaDeclaration => ({
  kind: 'saga',
  target,
  spec,
});

export const suppress = <T extends object>(
  target: { readonly prototype: T },
  spec: SuppressionSpec<T>,
): SuppressionDeclaration => ({
  kind: 'suppression',
  target,
  spec,
});

export const defineDomain = (config: DomainConfig): DomainConfig => config;
