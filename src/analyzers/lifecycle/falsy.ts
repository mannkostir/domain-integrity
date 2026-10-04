import { Type, ts } from 'ts-morph';

const isNonPrimitive = (type: Type): boolean => (type.getFlags() & ts.TypeFlags.NonPrimitive) !== 0;

const isObjectLike = (type: Type): boolean =>
  type.isObject() || isNonPrimitive(type) || (type.isIntersection() && type.getIntersectionTypes().every(isObjectLike));

const falsyLiteralTypes = (checker: ts.TypeChecker): readonly ts.Type[] => [
  checker.getStringLiteralType(''),
  checker.getNumberLiteralType(0),
  checker.getBigIntLiteralType({ negative: false, base10Value: '0' }),
  checker.getFalseType(),
];

export const mayBeFalsy = (checker: ts.TypeChecker, present: readonly Type[]): boolean => {
  const falsy = falsyLiteralTypes(checker);
  const acceptsFalsyLiteral = (member: Type): boolean =>
    falsy.some((literal) => checker.isTypeAssignableTo(literal, member.compilerType));
  return !present.every((member) => isObjectLike(member) && !acceptsFalsyLiteral(member));
};
