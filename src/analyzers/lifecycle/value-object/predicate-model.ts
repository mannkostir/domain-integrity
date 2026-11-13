import { MethodDeclaration, ParameterDeclaration } from 'ts-morph';
import { ScalarProjection } from './model';

export const MAX_PREDICATE_DEPTH = 8;
export const MAX_PREDICATE_WORK = 256;

export type PredicateUnknown = { readonly kind: 'unknown'; readonly reason: string };
export type PredicateRead<T> = { readonly kind: 'known'; readonly value: T } | PredicateUnknown;

export type PredicateExpression =
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'equals'; readonly token: string }
  | { readonly kind: 'includes'; readonly tokens: readonly string[] };

export type PredicateProgram =
  | { readonly kind: 'return'; readonly expression: PredicateExpression }
  | {
      readonly kind: 'switch';
      readonly cases: readonly { readonly token: string; readonly expression: PredicateExpression }[];
      readonly fallback: PredicateExpression;
    };

export type WrapperPredicate = {
  readonly scope: 'local-wrapper-predicate-body';
  readonly requires: ScalarProjection['requires'];
  readonly projection: ScalarProjection;
  readonly method: MethodDeclaration;
  readonly parameter: ParameterDeclaration | undefined;
  readonly program: PredicateProgram;
};

export type PredicateProof =
  | { readonly kind: 'proven'; readonly predicate: WrapperPredicate }
  | PredicateUnknown;

export type PredicateSources =
  | { readonly kind: 'known'; readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> }
  | PredicateUnknown;

export const unknownPredicate = (reason: string): PredicateUnknown => ({ kind: 'unknown', reason });
