import { Node, Type, ts } from 'ts-morph';
import { someReachable } from './reachable-types';

export type Comparable = (checker: ts.TypeChecker, first: Type, second: Type) => boolean;

type Pair = { readonly source: ts.Type; readonly target: ts.Type };

const LITERAL_FLAGS = ts.TypeFlags.Literal | ts.TypeFlags.EnumLiteral | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping;

const MAX_DEPTH = 6;

const isLiteral = (type: ts.Type): boolean => (type.flags & LITERAL_FLAGS) !== 0;

const isStructured = (type: ts.Type): boolean => (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;

const isOptional = (property: ts.Symbol): boolean => (property.flags & ts.SymbolFlags.Optional) !== 0;

const isOpaque = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  checker.getIndexInfosOfType(type).length > 0 ||
  checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
  checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0;

const isNestedComparison = (depth: number): boolean => depth > 0;

const widen = (checker: ts.TypeChecker, type: ts.Type): ts.Type => checker.getBaseTypeOfLiteralType(type);

const narrowerMembersOf = (checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] =>
  type.isUnion() && type.types.some((member) => widen(checker, member) !== type) ? type.types : [];

const isSamePair = (first: Pair, second: Pair): boolean => first.source === second.source && first.target === second.target;

const assignable = (checker: ts.TypeChecker, pair: Pair, depth: number): boolean =>
  checker.isTypeAssignableTo(pair.source, pair.target) ||
  depth > MAX_DEPTH ||
  widenedAssignable(checker, { source: widen(checker, pair.source), target: widen(checker, pair.target) }, depth);

const partAssignable = (checker: ts.TypeChecker, whole: Pair, part: Pair, depth: number): boolean => isSamePair(whole, part) || assignable(checker, part, depth + 1);

const propertyAssignable = (checker: ts.TypeChecker, widened: Pair, property: ts.Symbol, depth: number): boolean => {
  const counterpart = checker.getPropertyOfType(widened.source, property.getName());
  if (counterpart === undefined) return isOptional(property);
  return partAssignable(checker, widened, { source: checker.getTypeOfSymbol(counterpart), target: checker.getTypeOfSymbol(property) }, depth);
};

const propertiesAssignable = (checker: ts.TypeChecker, widened: Pair, depth: number): boolean =>
  checker.getPropertiesOfType(widened.target).every((property) => propertyAssignable(checker, widened, property, depth));

const structurallyAssignable = (checker: ts.TypeChecker, widened: Pair, depth: number): boolean => {
  if (!isStructured(widened.source) || !isStructured(widened.target)) return false;
  return isOpaque(checker, widened.target) ? isNestedComparison(depth) : propertiesAssignable(checker, widened, depth);
};

const widenedAssignable = (checker: ts.TypeChecker, widened: Pair, depth: number): boolean => {
  const { source, target } = widened;
  if (checker.isTypeAssignableTo(source, target)) return true;
  const sourceMembers = narrowerMembersOf(checker, source);
  if (sourceMembers.length > 0) return sourceMembers.every((member) => partAssignable(checker, widened, { source: member, target }, depth));
  const targetMembers = narrowerMembersOf(checker, target);
  if (targetMembers.length > 0) return targetMembers.some((member) => partAssignable(checker, widened, { source, target: member }, depth));
  return structurallyAssignable(checker, widened, depth);
};

export const hasLiteralType = (type: Type, location: Node): boolean => someReachable(type, location, (reached) => isLiteral(reached.compilerType));

export const strictlyComparable: Comparable = (checker, first, second) =>
  checker.isTypeAssignableTo(first.compilerType, second.compilerType) || checker.isTypeAssignableTo(second.compilerType, first.compilerType);

export const widelyComparable: Comparable = (checker, first, second) =>
  assignable(checker, { source: first.compilerType, target: second.compilerType }, 0) ||
  assignable(checker, { source: second.compilerType, target: first.compilerType }, 0);
