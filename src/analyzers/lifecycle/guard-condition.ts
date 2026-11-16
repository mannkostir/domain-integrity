import { BinaryExpression, CallExpression, Expression, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { SET, literalToken } from '../../engine/value-token';
import { isDefaultLibraryNode } from '../shared/library';
import { unwrap } from '../shared/wrappers';
import { AggregateScope, MAX_GETTER_DEPTH, fieldNameOf, referencesField, thisGetterExpression } from './field-ref';
import { comparedUnsetTokens, guardUniverse, unsetGuardTokens } from './guard-tokens';
import { ScalarReturnProof } from './scalar-callable';
import { StateField, UnsetForm } from './model';
import { allTokens, difference, intersect, union } from './values';

export type Evaluation = { readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> } | 'unknown';

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
  if (field.kind === 'boolean') {
    const whenTrue = intersect(guardUniverse(field), new Set(['true']));
    return { whenTrue, whenFalse: difference(guardUniverse(field), whenTrue) };
  }
  if (field.kind === 'nullable') return { whenTrue: new Set([SET]), whenFalse: falsyGuardTokens(field) };
  return field.unsetForms.length > 0 ? unsettableTruthiness(field) : 'unknown';
};

const unsetFormOf = (node: Expression): UnsetForm | undefined => {
  if (Node.isNullLiteral(node)) return 'null';
  return node.getText() === 'undefined' && node.getType().isUndefined() ? 'undefined' : undefined;
};

type ScalarComparison = 'strict' | 'loose' | 'same-value-zero';

const primitiveMatches = (left: string | number, right: string | number, comparison: ScalarComparison): boolean => {
  if (left === right) return true;
  if (comparison === 'same-value-zero') return typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right);
  return comparison === 'loose' && typeof left !== typeof right && Number(left) === Number(right);
};

const comparedTokens = (node: Expression, field: StateField, comparison: ScalarComparison, scope?: AggregateScope): ReadonlySet<string> | undefined => {
  const projection = scope?.projections?.projection(field.name);
  if (projection !== undefined) {
    if (scope?.projections?.literal(node, field.name) === undefined) return undefined;
    const operand = unwrap(node).getType().getLiteralValue();
    if (typeof operand !== 'string' && typeof operand !== 'number') return undefined;
    const values = projection.values.map(value => ({ token: value.token, primitive: value.member.getValue() }));
    if (!values.every((value): value is { readonly token: string; readonly primitive: string | number } =>
      typeof value.primitive === 'string' || typeof value.primitive === 'number')) return undefined;
    return new Set(values.filter(value => primitiveMatches(value.primitive, operand, comparison)).map(value => value.token));
  }
  const form = unsetFormOf(node);
  if (form !== undefined && field.unsetForms.length > 0) return comparedUnsetTokens(field, form, comparison !== 'loose');
  if (field.kind === 'nullable') return undefined;
  const type = node.getType();
  const token = literalToken(type);
  if (field.kind === 'boolean') {
    if (type.isBooleanLiteral() && token !== undefined) return intersect(allTokens(field), new Set([token]));
    return comparison !== 'loose' && type.isStringLiteral() ? new Set() : undefined;
  }
  if (type.isBooleanLiteral()) return comparison !== 'loose' ? new Set() : undefined;
  return token !== undefined && allTokens(field).has(token) ? new Set([token]) : undefined;
};

const scalarRead = (node: Node, field: StateField, scope: AggregateScope): boolean =>
  scope.projections?.projection(field.name) !== undefined ? scope.projections.scalar(node, field.name) : fieldNameOf(node) === field.name;

const comparedSide = (left: Expression, right: Expression, field: StateField, scope: AggregateScope): Expression | undefined => {
  if (scalarRead(left, field, scope)) return right;
  if (scalarRead(right, field, scope)) return left;
  return undefined;
};

const compare = (left: Expression, right: Expression, field: StateField, strict: boolean, scope: AggregateScope): Evaluation => {
  const other = comparedSide(left, right, field, scope);
  if (other !== undefined && referencesField(other, field.name, scope)) return 'unknown';
  const matching = other === undefined ? undefined : comparedTokens(other, field, strict ? 'strict' : 'loose', scope);
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

export const strictTokens = (node: Expression, field: StateField, scope?: AggregateScope): ReadonlySet<string> | undefined =>
  comparedTokens(node, field, 'strict', scope);

const elementTokens = (element: Expression, field: StateField, scope: AggregateScope): ReadonlySet<string> | undefined =>
  Node.isSpreadElement(element) || Node.isOmittedExpression(element) || referencesField(element, field.name, scope)
    ? undefined
    : comparedTokens(element, field, 'same-value-zero', scope);

const includedTokens = (receiver: Expression, field: StateField, scope: AggregateScope): ReadonlySet<string> | undefined => {
  const array = unwrap(receiver);
  if (!Node.isArrayLiteralExpression(array)) return undefined;
  const elements = array.getElements().map((element) => elementTokens(element, field, scope));
  return elements.every((tokens) => tokens !== undefined)
    ? elements.reduce<ReadonlySet<string>>((all, tokens) => union(all, tokens), new Set())
    : undefined;
};

const searchesField = (node: CallExpression, field: StateField, scope: AggregateScope): boolean => {
  const [searched, ...rest] = node.getArguments();
  return searched !== undefined && rest.length === 0 && scalarRead(searched, field, scope);
};

const isFollowedIncludes = (node: CallExpression, member: PropertyAccessExpression, field: StateField, scope: AggregateScope): boolean =>
  !node.hasQuestionDotToken() &&
  !member.hasQuestionDotToken() &&
  isLibraryMember(member) &&
  searchesField(node, field, scope);

const evaluateIncludes = (node: CallExpression, field: StateField, scope: AggregateScope): Evaluation => {
  const member = includesMember(node);
  if (member === undefined || !isFollowedIncludes(node, member, field, scope)) return 'unknown';
  const included = includedTokens(member.getExpression(), field, scope);
  return included === undefined ? 'unknown' : { whenTrue: included, whenFalse: difference(guardUniverse(field), included) };
};

const evaluateBinary = (node: BinaryExpression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof, expanded: boolean, depth: number): Evaluation => {
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
    const left = evaluate(node.getLeft(), field, scope, proof, expanded, depth);
    const right = evaluate(node.getRight(), field, scope, proof, expanded, depth);
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return operator === SyntaxKind.AmpersandAmpersandToken
      ? { whenTrue: intersect(left.whenTrue, right.whenTrue), whenFalse: union(left.whenFalse, right.whenFalse) }
      : { whenTrue: union(left.whenTrue, right.whenTrue), whenFalse: intersect(left.whenFalse, right.whenFalse) };
  }
  if (!referencesField(node, field.name, scope)) {
    return (expanded ? !proof.hasDataRead(node) : node.getDescendants().some(Node.isCallExpression))
      ? 'unknown' : { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
  }
  const strict = STRICT.has(operator);
  if (EQUALITY.has(operator)) return compare(node.getLeft(), node.getRight(), field, strict, scope);
  if (INEQUALITY.has(operator)) return negate(compare(node.getLeft(), node.getRight(), field, strict, scope));
  return 'unknown';
};

const evaluate = (node: Expression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof, expanded = false, depth = 0): Evaluation => {
  if (!proof.take()) return 'unknown';
  if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
    const universe = guardUniverse(field);
    return Node.isTrueLiteral(node) ? { whenTrue: universe, whenFalse: new Set() } : { whenTrue: new Set(), whenFalse: universe };
  }
  if (Node.isParenthesizedExpression(node)) return evaluate(node.getExpression(), field, scope, proof, expanded, depth);
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return negate(evaluate(node.getOperand(), field, scope, proof, expanded, depth));
  }
  if (Node.isBinaryExpression(node)) return evaluateBinary(node, field, scope, proof, expanded, depth);
  if (Node.isCallExpression(node)) {
    if (scope.projections?.projection(field.name) !== undefined) {
      const predicate = scope.projections.predicate(node, field);
      if (predicate !== 'unknown') return predicate;
    }
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && (Node.isThisExpression(callee.getExpression()) || Node.isSuperExpression(callee.getExpression()))) {
      const expression = proof.expression(node) ?? proof.expand(node);
      return expression === undefined ? 'unknown' : evaluate(expression, field, scope, proof, true, depth);
    }
    const member = includesMember(node);
    const receiver = Node.isPropertyAccessExpression(callee) ? fieldNameOf(callee.getExpression()) : undefined;
    if (receiver !== undefined && receiver !== field.name && scope.projections?.projection(receiver) !== undefined &&
      scope.projections.predicate(node, { ...field, name: receiver }) !== 'unknown' && !referencesField(node, field.name, scope)) {
      return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
    }
    return member === undefined ? 'unknown' : evaluateIncludes(node, field, scope);
  }
  if (scalarRead(node, field, scope)) return truthiness(field);
  if (!expanded) {
    if (!referencesField(node, field.name, scope)) return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
    const getter = depth < MAX_GETTER_DEPTH ? thisGetterExpression(node, scope.cls) : undefined;
    return getter === undefined ? 'unknown' : evaluate(getter, field, scope, proof, false, depth + 1);
  }
  const expression = proof.expression(node);
  if (expression !== undefined) return evaluate(expression, field, scope, proof, true, depth);
  return !referencesField(node, field.name, scope) && proof.hasDataRead(node)
    ? { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) } : 'unknown';
};

export const evaluateCondition = (node: Expression, field: StateField, scope: AggregateScope): Evaluation =>
  evaluate(node, field, scope, new ScalarReturnProof(field, scope));
