import { Node, Type, ts } from 'ts-morph';
import { someReachable } from './registrations/reachable-types';

export type Comparison = { readonly checker: ts.TypeChecker; readonly widening: boolean };

const LITERAL_FLAGS = ts.TypeFlags.Literal | ts.TypeFlags.EnumLiteral;

const MAX_DEPTH = 6;

const isBoolean = (type: ts.Type): boolean => (type.flags & ts.TypeFlags.Boolean) !== 0;

const isLiteral = (type: ts.Type): boolean => (type.flags & LITERAL_FLAGS) !== 0 && !isBoolean(type);

const bearsLiteral = (type: ts.Type): boolean => isLiteral(type) || (type.isUnionOrIntersection() && !isBoolean(type) && type.types.some(isLiteral));

const isStructured = (type: ts.Type): boolean => (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;

const isOptional = (property: ts.Symbol): boolean => (property.flags & ts.SymbolFlags.Optional) !== 0;

const isOpaque = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  checker.getIndexInfosOfType(type).length > 0 ||
  checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
  checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0;

const widen = (checker: ts.TypeChecker, type: ts.Type): ts.Type => checker.getBaseTypeOfLiteralType(type);

const assignable = (checker: ts.TypeChecker, source: ts.Type, target: ts.Type, depth: number): boolean => {
  if (checker.isTypeAssignableTo(source, target) || depth > MAX_DEPTH) return true;
  const widenedSource = widen(checker, source);
  const widenedTarget = widen(checker, target);
  if (bearsLiteral(widenedSource) || bearsLiteral(widenedTarget)) return true;
  if (widenedSource.isUnion()) return widenedSource.types.every((member) => assignable(checker, member, widenedTarget, depth + 1));
  if (widenedTarget.isUnion()) return widenedTarget.types.some((member) => assignable(checker, widenedSource, member, depth + 1));
  if (!isStructured(widenedSource) || !isStructured(widenedTarget)) return checker.isTypeAssignableTo(widenedSource, widenedTarget);
  return isOpaque(checker, widenedTarget) ? depth > 0 : propertiesAssignable(checker, widenedSource, widenedTarget, depth);
};

const propertyAssignable = (checker: ts.TypeChecker, source: ts.Type, property: ts.Symbol, depth: number): boolean => {
  const counterpart = checker.getPropertyOfType(source, property.getName());
  return counterpart === undefined ? isOptional(property) : assignable(checker, checker.getTypeOfSymbol(counterpart), checker.getTypeOfSymbol(property), depth + 1);
};

const propertiesAssignable = (checker: ts.TypeChecker, source: ts.Type, target: ts.Type, depth: number): boolean =>
  checker.getPropertiesOfType(target).every((property) => propertyAssignable(checker, source, property, depth));

const strictlyComparable = (checker: ts.TypeChecker, first: ts.Type, second: ts.Type): boolean =>
  checker.isTypeAssignableTo(first, second) || checker.isTypeAssignableTo(second, first);

const widelyComparable = (checker: ts.TypeChecker, first: ts.Type, second: ts.Type): boolean =>
  assignable(checker, first, second, 0) || assignable(checker, second, first, 0);

export const hasLiteralType = (type: Type, location: Node): boolean => someReachable(type, location, (reached) => isLiteral(reached.compilerType));

export const areComparable = ({ checker, widening }: Comparison, first: Type, second: Type): boolean =>
  widening ? widelyComparable(checker, first.compilerType, second.compilerType) : strictlyComparable(checker, first.compilerType, second.compilerType);
