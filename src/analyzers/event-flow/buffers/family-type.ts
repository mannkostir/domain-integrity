import { ClassDeclaration, Node, Symbol as MorphSymbol, Type, ts } from 'ts-morph';
import { familyHeritage } from './family-heritage';

type Holds = (type: Type) => boolean;

export type FamilyHolding = {
  readonly holdsInstance: Holds;
  readonly holdsAtSurface: Holds;
};

const optional = (type: Type | undefined): readonly Type[] => (type === undefined ? [] : [type]);

const constraintHolds = (type: Type, holds: Holds): boolean => {
  const constraint = type.getConstraint();
  return constraint !== undefined && holds(constraint);
};

const isHeritageInstance = (type: Type, heritage: ReadonlySet<Node>): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some((declaration) => heritage.has(declaration));

const isThisType = (type: Type): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration) || Node.isInterfaceDeclaration(declaration),
  );

const typeParameterHolds = (type: Type, heritage: ReadonlySet<Node>, holds: Holds): boolean =>
  isThisType(type) ? isHeritageInstance(type, heritage) : constraintHolds(type, holds);

const isNamedClassOrInterfaceType = (type: Type): boolean =>
  !type.isTypeParameter() && isThisType(type);

const isDeclaredInHeritage = (declaration: Node, heritage: ReadonlySet<Node>): boolean => {
  const owner = declaration.getParent();
  return owner !== undefined && heritage.has(owner);
};

const isHeritageProjection = (type: Type, heritage: ReadonlySet<Node>): boolean =>
  type.isObject() &&
  !isNamedClassOrInterfaceType(type) &&
  type.getProperties().some((property) => property.getDeclarations().some((declaration) => isDeclaredInHeritage(declaration, heritage)));

const isConstructorType = (type: Type): boolean => type.getConstructSignatures().length > 0;

const isAnonymousObject = (type: Type): boolean => type.isAnonymous() || (type.isObject() && type.getSymbol() === undefined);

const propertyHolds = (property: MorphSymbol, holds: Holds): boolean => {
  const declaration = property.getValueDeclaration();
  return declaration !== undefined && holds(declaration.getType());
};

const anonymousPropertyHolds = (type: Type, holds: Holds): boolean =>
  isAnonymousObject(type) && type.getProperties().some((property) => propertyHolds(property, holds));

const innerTypes = (type: Type): readonly Type[] => [
  ...type.getUnionTypes(),
  ...type.getIntersectionTypes(),
  ...type.getTypeArguments(),
  ...type.getAliasTypeArguments(),
  ...type.getTupleElements(),
  ...optional(type.getArrayElementType()),
  ...optional(type.getStringIndexType()),
  ...optional(type.getNumberIndexType()),
  ...type.getCallSignatures().map((signature) => signature.getReturnType()),
];

const holdsWithin =
  (heritage: ReadonlySet<Node>, seen: ReadonlySet<ts.Type>): Holds =>
  (type) => {
    if (seen.has(type.compilerType) || isConstructorType(type)) return false;
    const next = holdsWithin(heritage, new Set([...seen, type.compilerType]));
    return (
      (type.isTypeParameter() && typeParameterHolds(type, heritage, next)) ||
      isHeritageInstance(type, heritage) ||
      isHeritageProjection(type, heritage) ||
      innerTypes(type).some(next) ||
      anonymousPropertyHolds(type, next)
    );
  };

const surfaceHolds =
  (heritage: ReadonlySet<Node>): Holds =>
  (type) => {
    if (isConstructorType(type)) return false;
    const next = surfaceHolds(heritage);
    return (
      (type.isTypeParameter() && typeParameterHolds(type, heritage, next)) ||
      isHeritageInstance(type, heritage) ||
      isHeritageProjection(type, heritage) ||
      [...type.getUnionTypes(), ...type.getIntersectionTypes()].some(next)
    );
  };

const memoised = (holds: Holds): Holds => {
  const known = new Map<ts.Type, boolean>();
  return (type) => {
    const cached = known.get(type.compilerType);
    if (cached !== undefined) return cached;
    const result = holds(type);
    known.set(type.compilerType, result);
    return result;
  };
};

export const familyHolding = (family: readonly ClassDeclaration[]): FamilyHolding => {
  const heritage = familyHeritage(family);
  return {
    holdsInstance: memoised(holdsWithin(heritage, new Set())),
    holdsAtSurface: memoised(surfaceHolds(heritage)),
  };
};
