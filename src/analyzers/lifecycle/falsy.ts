import { ClassDeclaration, Type, ts } from 'ts-morph';

const isNonPrimitive = (type: Type): boolean => (type.getFlags() & ts.TypeFlags.NonPrimitive) !== 0;

const isObjectLike = (type: Type): boolean =>
  type.isObject() || isNonPrimitive(type) || (type.isIntersection() && type.getIntersectionTypes().every(isObjectLike));

const falsyLiteralTypes = (checker: ts.TypeChecker): readonly ts.Type[] => [
  checker.getStringLiteralType(''),
  checker.getNumberLiteralType(0),
  checker.getBigIntLiteralType({ negative: false, base10Value: '0' }),
  checker.getFalseType(),
];

const acceptsFalsyLiteral = (checker: ts.TypeChecker, member: Type): boolean =>
  falsyLiteralTypes(checker).some((falsy) => checker.isTypeAssignableTo(falsy, member.compilerType));

const cannotBeFalsy = (checker: ts.TypeChecker, member: Type): boolean => isObjectLike(member) && !acceptsFalsyLiteral(checker, member);

export const mayBeFalsy = (cls: ClassDeclaration, present: readonly Type[]): boolean => {
  const checker = cls.getProject().getTypeChecker().compilerObject;
  return !present.every((member) => cannotBeFalsy(checker, member));
};
