import { BinaryExpression, CallExpression, Expression, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { SET, literalToken } from '../../engine/value-token';
import { isDefaultLibraryNode } from '../shared/library';
import { unwrap } from '../shared/wrappers';
import { AggregateScope, fieldNameOf, isAssertedInertLibraryMember, referencesField, scalarCallable } from './field-ref';
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

export const scalarRead = (node: Node, field: StateField, scope: AggregateScope): boolean =>
  scope.projections?.projection(field.name) !== undefined ? scope.projections.scalar(node, field.name) : fieldNameOf(node) === field.name;

const compare = (left: Expression, right: Expression, originalLeft: Expression, originalRight: Expression, field: StateField, strict: boolean, scope: AggregateScope): Evaluation => {
  const leftTracked = scalarRead(left, field, scope);
  const rightTracked = scalarRead(right, field, scope);
  if (leftTracked === rightTracked) return 'unknown';
  const other = leftTracked ? right : left;
  const originalOther = leftTracked ? originalRight : originalLeft;
  if (referencesField(other, field.name, scope) || referencesField(originalOther, field.name, scope)) return 'unknown';
  const matching = comparedTokens(other, field, strict ? 'strict' : 'loose', scope);
  return matching === undefined ? 'unknown' : { whenTrue: matching, whenFalse: difference(guardUniverse(field), matching) };
};

const includesMember = (node: CallExpression): PropertyAccessExpression | undefined => {
  const callee = node.getExpression();
  return Node.isPropertyAccessExpression(callee) && callee.getName() === 'includes' ? callee : undefined;
};

const isLibraryMember = (member: PropertyAccessExpression): boolean => {
  const declarations = member.getNameNode().getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
};

export const strictTokens = (node: Expression, field: StateField, scope?: AggregateScope, proof?: ScalarReturnProof): ReadonlySet<string> | undefined => {
  const normalized = proof === undefined ? node : proof.normalize(node);
  return normalized === undefined || (scope !== undefined &&
    (referencesField(node, field.name, scope) || referencesField(normalized, field.name, scope)))
    ? undefined : comparedTokens(normalized, field, 'strict', scope);
};

const elementTokens = (element: Expression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof): ReadonlySet<string> | undefined => {
  if (Node.isSpreadElement(element) || Node.isOmittedExpression(element)) return undefined;
  const normalized = proof.normalize(element);
  return normalized === undefined || referencesField(element, field.name, scope) || referencesField(normalized, field.name, scope)
    ? undefined : comparedTokens(normalized, field, 'same-value-zero', scope);
};

const includedTokens = (receiver: Expression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof): ReadonlySet<string> | undefined => {
  const array = unwrap(receiver);
  if (!Node.isArrayLiteralExpression(array)) return undefined;
  const elements = array.getElements().map((element) => elementTokens(element, field, scope, proof));
  return elements.every((tokens) => tokens !== undefined)
    ? elements.reduce<ReadonlySet<string>>((all, tokens) => union(all, tokens), new Set())
    : undefined;
};

const evaluateIncludes = (node: CallExpression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof): Evaluation => {
  const member = includesMember(node);
  const arguments_ = node.getArguments();
  const searched = arguments_[0];
  if (member === undefined || node.hasQuestionDotToken() || member.hasQuestionDotToken() || !isLibraryMember(member) ||
    !scope.scalarCallables.includesStable() || arguments_.length !== 1 || !Node.isExpression(searched)) return 'unknown';
  const normalized = proof.normalize(searched);
  if (normalized === undefined || !scalarRead(normalized, field, scope)) return 'unknown';
  const included = includedTokens(member.getExpression(), field, scope, proof);
  return included === undefined ? 'unknown' : { whenTrue: included, whenFalse: difference(guardUniverse(field), included) };
};

const changedOperand = (original: Expression, normalized: Expression): boolean =>
  Node.isParenthesizedExpression(original) ? changedOperand(original.getExpression(), normalized) : original !== normalized;

const independentLibraryOperand = (node: Expression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof): 'asserted' | 'literal' | 'unknown' => {
  if (!proof.take()) return 'unknown';
  if (Node.isParenthesizedExpression(node)) return independentLibraryOperand(node.getExpression(), field, scope, proof);
  if (isAssertedInertLibraryMember(node, field.name, scope) && proof.inertArguments(node)) return 'asserted';
  return Node.isTrueLiteral(node) || Node.isFalseLiteral(node) || Node.isNullLiteral(node) || Node.isStringLiteral(node) ||
    Node.isNumericLiteral(node) || Node.isBigIntLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? 'literal' : 'unknown';
};

const evaluateBinary = (node: BinaryExpression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof, expanded: boolean): Evaluation => {
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
    const left = evaluate(node.getLeft(), field, scope, proof, expanded);
    const right = evaluate(node.getRight(), field, scope, proof, expanded);
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return operator === SyntaxKind.AmpersandAmpersandToken
      ? { whenTrue: intersect(left.whenTrue, right.whenTrue), whenFalse: union(left.whenFalse, right.whenFalse) }
      : { whenTrue: union(left.whenTrue, right.whenTrue), whenFalse: intersect(left.whenFalse, right.whenFalse) };
  }
  if (!expanded && STRICT.has(operator)) {
    const left = independentLibraryOperand(node.getLeft(), field, scope, proof);
    const right = independentLibraryOperand(node.getRight(), field, scope, proof);
    if (left !== 'unknown' && right !== 'unknown' && (left === 'asserted' || right === 'asserted')) {
      return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
    }
  }
  if (EQUALITY.has(operator) || INEQUALITY.has(operator)) {
    const left = proof.normalize(node.getLeft(), 'nullish');
    const right = proof.normalize(node.getRight(), 'nullish');
    if (left === undefined || right === undefined) return 'unknown';
    if (scalarRead(left, field, scope) || scalarRead(right, field, scope)) {
      const compared = compare(left, right, node.getLeft(), node.getRight(), field, STRICT.has(operator), scope);
      return INEQUALITY.has(operator) ? negate(compared) : compared;
    }
    if (changedOperand(node.getLeft(), left) || changedOperand(node.getRight(), right) ||
      referencesField(left, field.name, scope) || referencesField(right, field.name, scope)) return 'unknown';
  }
  if (!referencesField(node, field.name, scope)) {
    return (expanded ? !proof.hasDataRead(node) : node.getDescendants().some(Node.isCallExpression))
      ? 'unknown' : { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
  }
  return 'unknown';
};

const evaluate = (node: Expression, field: StateField, scope: AggregateScope, proof: ScalarReturnProof, expanded = false): Evaluation => {
  if (!proof.take()) return 'unknown';
  if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
    const universe = guardUniverse(field);
    return Node.isTrueLiteral(node) ? { whenTrue: universe, whenFalse: new Set() } : { whenTrue: new Set(), whenFalse: universe };
  }
  if (Node.isParenthesizedExpression(node)) return evaluate(node.getExpression(), field, scope, proof, expanded);
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return negate(evaluate(node.getOperand(), field, scope, proof, expanded));
  }
  if (!expanded && isAssertedInertLibraryMember(node, field.name, scope) && proof.inertArguments(node)) {
    return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
  }
  if (Node.isBinaryExpression(node)) return evaluateBinary(node, field, scope, proof, expanded);
  if (Node.isCallExpression(node)) {
    if (scope.projections?.projection(field.name) !== undefined) {
      const predicate = scope.projections.predicate(node, field);
      if (predicate !== 'unknown') return predicate;
    }
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee) && (Node.isThisExpression(callee.getExpression()) || Node.isSuperExpression(callee.getExpression()))) {
      const expression = proof.expression(node, 'condition') ?? proof.expand(node, 'condition');
      return expression === undefined ? 'unknown' : evaluate(expression, field, scope, proof, true);
    }
    const member = includesMember(node);
    const receiver = Node.isPropertyAccessExpression(callee) ? fieldNameOf(callee.getExpression()) : undefined;
    if (receiver !== undefined && receiver !== field.name && scope.projections?.projection(receiver) !== undefined &&
      scope.projections.predicate(node, { ...field, name: receiver }) !== 'unknown' && !referencesField(node, field.name, scope)) {
      return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
    }
    return member === undefined ? 'unknown' : evaluateIncludes(node, field, scope, proof);
  }
  if (scalarRead(node, field, scope)) return truthiness(field);
  const expression = proof.expression(node, 'condition') ?? (scalarCallable(node, scope) === undefined ? undefined : proof.expand(node, 'condition'));
  if (expression !== undefined) return evaluate(expression, field, scope, proof, true);
  const normalized = proof.normalize(node);
  if (normalized === undefined) return 'unknown';
  if (normalized !== node) return evaluate(normalized, field, scope, proof, true);
  return !referencesField(node, field.name, scope) && (!expanded || proof.hasDataRead(node))
    ? { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) } : 'unknown';
};

export const evaluateCondition = (node: Expression, field: StateField, scope: AggregateScope): Evaluation => {
  const proof = new ScalarReturnProof(field, scope);
  const evaluation = evaluate(node, field, scope, proof);
  return proof.valid() ? evaluation : 'unknown';
};
