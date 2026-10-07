import { ClassDeclaration, Node, Symbol as MorphSymbol, Type, ts } from 'ts-morph';
import { familyHeritage } from './family-heritage';

export type Holds = (type: Type) => boolean;

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

const memberOwner = (declaration: Node): Node | undefined => {
  const parent = declaration.getParent();
  return Node.isParameterDeclaration(declaration) && declaration.isParameterProperty() ? parent?.getParent() : parent;
};

const isDeclaredInHeritage = (declaration: Node, heritage: ReadonlySet<Node>): boolean => {
  const owner = memberOwner(declaration);
  return owner !== undefined && heritage.has(owner);
};

const isHeritageProjection = (type: Type, heritage: ReadonlySet<Node>): boolean =>
  type.isObject() &&
  !isNamedClassOrInterfaceType(type) &&
  type.getProperties().some((property) => property.getDeclarations().some((declaration) => isDeclaredInHeritage(declaration, heritage)));

const isConstructorType = (type: Type): boolean => type.getConstructSignatures().length > 0;

type PropertyType = (property: MorphSymbol) => Type | undefined;

const isMapped = (type: Type): boolean => (type.getObjectFlags() & ts.ObjectFlags.Mapped) !== 0;

const isStructuralObject = (type: Type): boolean =>
  type.isAnonymous() || isMapped(type) || (type.isObject() && type.getSymbol() === undefined);

const propertyHolds = (property: MorphSymbol, typeOf: PropertyType, holds: Holds): boolean => {
  const type = typeOf(property);
  return type !== undefined && holds(type);
};

const structuralPropertyHolds = (type: Type, typeOf: PropertyType, holds: Holds): boolean =>
  isStructuralObject(type) && type.getProperties().some((property) => propertyHolds(property, typeOf, holds));

const propertyTypeIn = (family: readonly ClassDeclaration[]): PropertyType => {
  const anchor = family[0];
  return (property) =>
    anchor === undefined
      ? property.getValueDeclaration()?.getType()
      : anchor.getProject().getTypeChecker().getTypeOfSymbolAtLocation(property, anchor);
};

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
  (heritage: ReadonlySet<Node>, typeOf: PropertyType, seen: ReadonlySet<ts.Type>): Holds =>
  (type) => {
    if (seen.has(type.compilerType) || isConstructorType(type)) return false;
    const next = holdsWithin(heritage, typeOf, new Set([...seen, type.compilerType]));
    return (
      (type.isTypeParameter() && typeParameterHolds(type, heritage, next)) ||
      isHeritageInstance(type, heritage) ||
      isHeritageProjection(type, heritage) ||
      innerTypes(type).some(next) ||
      structuralPropertyHolds(type, typeOf, next)
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
    holdsInstance: memoised(holdsWithin(heritage, propertyTypeIn(family), new Set())),
    holdsAtSurface: memoised(surfaceHolds(heritage)),
  };
};
