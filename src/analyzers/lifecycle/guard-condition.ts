import { BinaryExpression, CallExpression, Expression, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { SET, literalToken } from '../../engine/value-token';
import { isDefaultLibraryNode } from '../shared/library';
import { unwrap } from '../shared/wrappers';
import { AggregateScope, fieldNameOf, referencesField, thisGetterExpression } from './field-ref';
import { comparedUnsetTokens, guardUniverse, unsetGuardTokens } from './guard-tokens';
import { StateField, UnsetForm } from './model';
import { allTokens, difference, intersect, union } from './values';

export type Evaluation = { readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> } | 'unknown';

const MAX_GETTER_DEPTH = 5;
const EQUALITY = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken]);
const INEQUALITY = new Set<SyntaxKind>([SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);
const STRICT = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken]);

const negate = (evaluation: Evaluation): Evaluation =>
  evaluation === 'unknown' ? evaluation : { whenTrue: evaluation.whenFalse, whenFalse: evaluation.whenTrue };

const falsyGuardTokens = (field: StateField): ReadonlySet<string> =>
  field.setMayBeFalsy ? guardUniverse(field) : unsetGuardTokens(field);

const unsettableTruthiness = (field: StateField): Evaluation => {
  const unset = unsetGuardTokens(field);
  return field.setMayBeFalsy ? 'unknown' : { whenTrue: difference(guardUniverse(field), unset), whenFalse: unset };
};

const truthiness = (field: StateField): Evaluation => {
  if (field.kind === 'boolean') return { whenTrue: new Set(['true']), whenFalse: new Set(['false']) };
  if (field.kind === 'nullable') return { whenTrue: new Set([SET]), whenFalse: falsyGuardTokens(field) };
  return field.unsetForms.length > 0 ? unsettableTruthiness(field) : 'unknown';
};

const unsetFormOf = (node: Expression): UnsetForm | undefined => {
  if (Node.isNullLiteral(node)) return 'null';
  return node.getText() === 'undefined' ? 'undefined' : undefined;
};

const comparedTokens = (node: Expression, field: StateField, strict: boolean): ReadonlySet<string> | undefined => {
  const form = unsetFormOf(node);
  if (form !== undefined && field.unsetForms.length > 0) return comparedUnsetTokens(field, form, strict);
  if (field.kind === 'nullable') return undefined;
  const token = literalToken(node.getType());
  return token !== undefined && allTokens(field).has(token) ? new Set([token]) : undefined;
};

const comparedSide = (left: Expression, right: Expression, field: StateField): Expression | undefined => {
  if (fieldNameOf(left) === field.name) return right;
  if (fieldNameOf(right) === field.name) return left;
  return undefined;
};

const compare = (left: Expression, right: Expression, field: StateField, strict: boolean): Evaluation => {
  const other = comparedSide(left, right, field);
  const matching = other === undefined ? undefined : comparedTokens(other, field, strict);
  if (matching === undefined) return 'unknown';
  return { whenTrue: matching, whenFalse: difference(guardUniverse(field), matching) };
};

const includesMember = (node: CallExpression): PropertyAccessExpression | undefined => {
  const callee = node.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'includes' ? callee : undefined;
};

const isLibraryMember = (member: PropertyAccessExpression): boolean => {
  const declarations = member.getNameNode().getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
};

export const strictTokens = (node: Expression, field: StateField): ReadonlySet<string> | undefined =>
  comparedTokens(node, field, true);

const elementTokens = (element: Expression, field: StateField, scope: AggregateScope): ReadonlySet<string> | undefined =>
  Node.isSpreadElement(element) || Node.isOmittedExpression(element) || referencesField(element, field.name, scope)
    ? undefined
    : strictTokens(element, field);

const includedTokens = (receiver: Expression, field: StateField, scope: AggregateScope): ReadonlySet<string> | undefined => {
  const array = unwrap(receiver);
  if (!Node.isArrayLiteralExpression(array)) return undefined;
  const elements = array.getElements().map((element) => elementTokens(element, field, scope));
  return elements.every((tokens) => tokens !== undefined)
    ? elements.reduce<ReadonlySet<string>>((all, tokens) => union(all, tokens), new Set())
    : undefined;
};

const searchesField = (node: CallExpression, field: StateField): boolean => {
  const [searched, ...rest] = node.getArguments();
  return searched !== undefined && rest.length === 0 && fieldNameOf(searched) === field.name;
};

const isFollowedIncludes = (node: CallExpression, member: PropertyAccessExpression, field: StateField): boolean =>
  !node.hasQuestionDotToken() &&
  !member.hasQuestionDotToken() &&
  isLibraryMember(member) &&
  searchesField(node, field);

const evaluateIncludes = (node: CallExpression, field: StateField, scope: AggregateScope): Evaluation => {
  const member = includesMember(node);
  if (member === undefined || !isFollowedIncludes(node, member, field)) return 'unknown';
  const included = includedTokens(member.getExpression(), field, scope);
  return included === undefined ? 'unknown' : { whenTrue: included, whenFalse: difference(guardUniverse(field), included) };
};

const evaluateBinary = (node: BinaryExpression, field: StateField, scope: AggregateScope, depth: number): Evaluation => {
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
    const left = evaluateCondition(node.getLeft(), field, scope, depth);
    const right = evaluateCondition(node.getRight(), field, scope, depth);
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return operator === SyntaxKind.AmpersandAmpersandToken
      ? { whenTrue: intersect(left.whenTrue, right.whenTrue), whenFalse: union(left.whenFalse, right.whenFalse) }
      : { whenTrue: union(left.whenTrue, right.whenTrue), whenFalse: intersect(left.whenFalse, right.whenFalse) };
  }
  const strict = STRICT.has(operator);
  if (EQUALITY.has(operator)) return compare(node.getLeft(), node.getRight(), field, strict);
  if (INEQUALITY.has(operator)) return negate(compare(node.getLeft(), node.getRight(), field, strict));
  return 'unknown';
};

export const evaluateCondition = (node: Expression, field: StateField, scope: AggregateScope, depth = 0): Evaluation => {
  if (!referencesField(node, field.name, scope)) return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
  if (Node.isParenthesizedExpression(node)) return evaluateCondition(node.getExpression(), field, scope, depth);
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return negate(evaluateCondition(node.getOperand(), field, scope, depth));
  }
  if (Node.isBinaryExpression(node)) return evaluateBinary(node, field, scope, depth);
  if (Node.isCallExpression(node)) return evaluateIncludes(node, field, scope);
  if (fieldNameOf(node) === field.name) return truthiness(field);
  const getter = depth < MAX_GETTER_DEPTH ? thisGetterExpression(node, scope.cls) : undefined;
  return getter === undefined ? 'unknown' : evaluateCondition(getter, field, scope, depth + 1);
};
