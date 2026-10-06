export type StateToken = string | number | boolean;

type MethodName<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
  string;

export type FieldSpec<T> = {
  readonly terminal: StateToken | readonly StateToken[];
  readonly transitions?: Partial<Record<MethodName<T>, readonly StateToken[]>>;
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

export type DomainConfig = {
  readonly aggregateBaseClasses?: readonly string[];
  readonly auditFields?: readonly string[];
  readonly eventMethods?: readonly string[];
  readonly inertEventMethods?: readonly string[];
  readonly inertMembers?: readonly string[];
  readonly lifecycles?: readonly LifecycleDeclaration[];
};

export const lifecycle = <T extends object>(
  target: { readonly prototype: T },
  spec: LifecycleSpec<T>,
): LifecycleDeclaration => ({ kind: 'lifecycle', target, spec });

export const defineDomain = (config: DomainConfig): DomainConfig => config;
