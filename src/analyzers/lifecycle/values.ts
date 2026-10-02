import { AssignedValues, StateField } from './model';

export const intersect = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> =>
  new Set([...a].filter((item) => b.has(item)));

export const union = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> => new Set([...a, ...b]);

export const difference = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): ReadonlySet<T> =>
  new Set([...a].filter((item) => !b.has(item)));

export const allTokens = (field: StateField): ReadonlySet<string> => new Set(field.values.map((value) => value.token));

export const NOTHING_ASSIGNED: AssignedValues = { tokens: new Set(), unresolved: false, mayWrite: false };

export const UNRESOLVED: AssignedValues = { tokens: new Set(), unresolved: true, mayWrite: false };

export const MAY_WRITE: AssignedValues = { tokens: new Set(), unresolved: false, mayWrite: true };

export const assignedToken = (token: string): AssignedValues => ({ tokens: new Set([token]), unresolved: false, mayWrite: false });

export const mergeAssigned = (values: readonly AssignedValues[]): AssignedValues => ({
  tokens: new Set(values.flatMap((value) => [...value.tokens])),
  unresolved: values.some((value) => value.unresolved),
  mayWrite: values.some((value) => value.mayWrite),
});

export const writesField = (value: AssignedValues): boolean => value.tokens.size > 0 || value.unresolved;

export const hasUnknownWrite = (value: AssignedValues): boolean => value.unresolved || value.mayWrite;
