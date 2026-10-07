import { ClassDeclaration, Node, Symbol as MorphSymbol, Type, ts } from 'ts-morph';

type Holds = (type: Type) => boolean;

const isUnconstrainedOrHolding = (type: Type, holds: Holds): boolean => {
  const constraint = type.getConstraint();
  return constraint === undefined || holds(constraint);
};

const isFamilyInstance = (type: Type, family: readonly ClassDeclaration[]): boolean =>
  (type.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) => Node.isClassDeclaration(declaration) && family.includes(declaration),
  );

const acceptsFamilyInstance = (type: Type, instances: readonly Type[]): boolean =>
  instances.some((instance) => instance.isAssignableTo(type));

const isWeakObject = (type: Type): boolean => {
  const properties = type.getProperties();
  return (
    type.isObject() &&
    properties.length > 0 &&
    properties.every((property) => property.isOptional()) &&
    type.getCallSignatures().length === 0 &&
    type.getConstructSignatures().length === 0 &&
    type.getStringIndexType() === undefined &&
    type.getNumberIndexType() === undefined
  );
};

const isAnonymousObject = (type: Type): boolean => type.isAnonymous() || (type.isObject() && type.getSymbol() === undefined);

const propertyMayHold = (property: MorphSymbol, holds: Holds): boolean => {
  const declaration = property.getValueDeclaration();
  return declaration === undefined || holds(declaration.getType());
};

const anonymousPropertyMayHold = (type: Type, holds: Holds): boolean =>
  isAnonymousObject(type) && type.getProperties().some((property) => propertyMayHold(property, holds));

const optional = (type: Type | undefined): readonly Type[] => (type === undefined ? [] : [type]);

const innerTypes = (type: Type): readonly Type[] => [
  ...type.getUnionTypes(),
  ...type.getIntersectionTypes(),
  ...type.getTypeArguments(),
  ...type.getAliasTypeArguments(),
  ...type.getTupleElements(),
  ...optional(type.getArrayElementType()),
  ...optional(type.getStringIndexType()),
  ...optional(type.getNumberIndexType()),
];

const isNonPrimitive = (type: Type): boolean => (type.getFlags() & ts.TypeFlags.NonPrimitive) !== 0;

const holdsWithin =
  (family: readonly ClassDeclaration[], instances: readonly Type[], seen: ReadonlySet<ts.Type>): Holds =>
  (type) => {
    if (seen.has(type.compilerType)) return false;
    const next = holdsWithin(family, instances, new Set([...seen, type.compilerType]));
    return (
      type.isAny() ||
      type.isUnknown() ||
      isNonPrimitive(type) ||
      (type.isTypeParameter() && isUnconstrainedOrHolding(type, next)) ||
      isFamilyInstance(type, family) ||
      acceptsFamilyInstance(type, instances) ||
      isWeakObject(type) ||
      innerTypes(type).some(next) ||
      anonymousPropertyMayHold(type, next)
    );
  };

export const mayHoldFamily = (family: readonly ClassDeclaration[]): Holds => {
  const instances = family.map((declaration) => declaration.getType());
  const holds = holdsWithin(family, instances, new Set());
  const known = new Map<ts.Type, boolean>();
  return (type) => {
    const cached = known.get(type.compilerType);
    if (cached !== undefined) return cached;
    const result = holds(type);
    known.set(type.compilerType, result);
    return result;
  };
};
