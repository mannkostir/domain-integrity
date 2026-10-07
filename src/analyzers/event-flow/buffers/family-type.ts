import { ClassDeclaration, Node, Symbol as MorphSymbol, Type, ts } from 'ts-morph';
import { familyHeritage } from './family-heritage';

type Holds = (type: Type) => boolean;

export type FamilyHolding = {
  readonly mayHold: Holds;
  readonly holdsInstance: Holds;
};

type Openness = {
  readonly isOpen: Holds;
  readonly undeclaredPropertyHolds: boolean;
};

const optional = (type: Type | undefined): readonly Type[] => (type === undefined ? [] : [type]);

const constraintHolds = (type: Type, holds: Holds): boolean => {
  const constraint = type.getConstraint();
  return constraint !== undefined && holds(constraint);
};

const hasNoSignatures = (type: Type): boolean =>
  type.getCallSignatures().length === 0 &&
  type.getConstructSignatures().length === 0 &&
  type.getStringIndexType() === undefined &&
  type.getNumberIndexType() === undefined;

const isEmptyObject = (type: Type): boolean => type.isObject() && type.getProperties().length === 0 && hasNoSignatures(type);

const isNonPrimitive = (type: Type): boolean => (type.getFlags() & ts.TypeFlags.NonPrimitive) !== 0;

const isHeritageInstance = (type: Type, heritage: ReadonlySet<Node>): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some((declaration) => heritage.has(declaration));

const isThisType = (type: Type): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      Node.isClassDeclaration(declaration) || Node.isClassExpression(declaration) || Node.isInterfaceDeclaration(declaration),
  );

const typeParameterHolds = (type: Type, heritage: ReadonlySet<Node>, holds: Holds): boolean =>
  isThisType(type) ? isHeritageInstance(type, heritage) : constraintHolds(type, holds);

const isUnconstrainedTypeParameter = (type: Type): boolean =>
  type.isTypeParameter() && !isThisType(type) && type.getConstraint() === undefined;

const isOpenType = (type: Type): boolean =>
  type.isAny() || type.isUnknown() || isNonPrimitive(type) || isEmptyObject(type) || isUnconstrainedTypeParameter(type);

const OPEN: Openness = { isOpen: isOpenType, undeclaredPropertyHolds: true };
const CLOSED: Openness = { isOpen: () => false, undeclaredPropertyHolds: false };

const isConstructorType = (type: Type): boolean => type.getConstructSignatures().length > 0;

const isAnonymousObject = (type: Type): boolean => type.isAnonymous() || (type.isObject() && type.getSymbol() === undefined);

const propertyHolds = (property: MorphSymbol, holds: Holds, openness: Openness): boolean => {
  const declaration = property.getValueDeclaration();
  return declaration === undefined ? openness.undeclaredPropertyHolds : holds(declaration.getType());
};

const anonymousPropertyHolds = (type: Type, holds: Holds, openness: Openness): boolean =>
  isAnonymousObject(type) && type.getProperties().some((property) => propertyHolds(property, holds, openness));

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
  (heritage: ReadonlySet<Node>, openness: Openness, seen: ReadonlySet<ts.Type>): Holds =>
  (type) => {
    if (seen.has(type.compilerType) || isConstructorType(type)) return false;
    const next = holdsWithin(heritage, openness, new Set([...seen, type.compilerType]));
    return (
      openness.isOpen(type) ||
      (type.isTypeParameter() && typeParameterHolds(type, heritage, next)) ||
      isHeritageInstance(type, heritage) ||
      innerTypes(type).some(next) ||
      anonymousPropertyHolds(type, next, openness)
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

export const mayHoldFamily = (family: readonly ClassDeclaration[]): FamilyHolding => {
  const heritage = familyHeritage(family);
  return {
    mayHold: memoised(holdsWithin(heritage, OPEN, new Set())),
    holdsInstance: memoised(holdsWithin(heritage, CLOSED, new Set())),
  };
};
