import { Node, Type } from 'ts-morph';

type ReachableTypes = { readonly kind: 'bounded'; readonly types: readonly Type[] } | { readonly kind: 'overflow' };

const MAX_DEPTH = 8;

const MAX_TYPES = 1000;

const OVERFLOW: ReachableTypes = { kind: 'overflow' };

const propertyTypesOf = (type: Type, location: Node): readonly Type[] => type.getProperties().map((property) => property.getTypeAtLocation(location));

const childrenOf = (type: Type, location: Node): readonly Type[] =>
  type.isTypeParameter()
    ? []
    : [...type.getUnionTypes(), ...type.getIntersectionTypes(), ...type.getTypeArguments(), ...type.getAliasTypeArguments(), ...propertyTypesOf(type, location)];

const distinct = (types: readonly Type[]): readonly Type[] => [...new Map(types.map((type) => [type.compilerType, type])).values()];

const expand = (frontier: readonly Type[], reached: readonly Type[], depth: number, location: Node): ReachableTypes => {
  if (frontier.length === 0) return { kind: 'bounded', types: reached };
  if (depth >= MAX_DEPTH || reached.length > MAX_TYPES) return OVERFLOW;
  const known = new Set(reached.map((type) => type.compilerType));
  const next = distinct(frontier.flatMap((type) => childrenOf(type, location))).filter((type) => !known.has(type.compilerType));
  return expand(next, [...reached, ...next], depth + 1, location);
};

const reachableTypes = (root: Type, location: Node): ReachableTypes => expand([root], [root], 0, location);

export const someReachable = (root: Type, location: Node, predicate: (type: Type) => boolean): boolean => {
  const reachable = reachableTypes(root, location);
  return reachable.kind === 'overflow' || reachable.types.some(predicate);
};
