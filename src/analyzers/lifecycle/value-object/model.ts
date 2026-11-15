import { ClassDeclaration, ConstructorDeclaration, EnumDeclaration, EnumMember, GetAccessorDeclaration, ParameterDeclaration, PropertyDeclaration, Symbol as MorphSymbol } from 'ts-morph';

export const MAX_PROJECTION_DEPTH = 5;

export type ScalarValue = {
  readonly token: string;
  readonly label: string;
  readonly member: EnumMember;
};

export type ScalarProjection = {
  readonly scope: 'local-construction-and-getter';
  readonly requires: readonly ['observable-mutation-and-escape-analysis', 'dispatch-invalidation'];
  readonly wrapper: ClassDeclaration;
  readonly getter: GetAccessorDeclaration;
  readonly storage: {
    readonly holder: PropertyDeclaration;
    readonly slot: MorphSymbol;
    readonly slotName: string;
  };
  readonly enumDeclaration: EnumDeclaration;
  readonly values: readonly ScalarValue[];
  readonly construction: {
    readonly declaration: ConstructorDeclaration;
    readonly parameter: ParameterDeclaration;
  };
};

export type ProjectionProof =
  | { readonly kind: 'proven'; readonly projection: ScalarProjection }
  | { readonly kind: 'unsupported'; readonly reason: string };

export type ProjectedValue =
  | { readonly kind: 'known'; readonly token: string }
  | { readonly kind: 'unresolved'; readonly reason: string };
