import { BinaryExpression, Expression, Node, SyntaxKind } from 'ts-morph';
import { SET, UNSET, isNullish, literalToken } from '../../engine/value-token';
import { escapesStateHolder, fieldNameOf, isRootedAtThis } from './field-ref';
import { AssignedValues, StateField } from './model';
import { MAY_WRITE, UNRESOLVED, allTokens, assignedToken, mergeAssigned } from './values';
import { unwrap } from '../shared/wrappers';

export const isAssignmentOperator = (node: BinaryExpression): boolean => {
  const kind = node.getOperatorToken().getKind();
  return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;
};

const tokenOfAssigned = (value: Expression, field: StateField): string | undefined => {
  const type = value.getType();
  if (field.kind === 'nullable') {
    if (isNullish(type)) return UNSET;
    const members = type.isUnion() ? type.getUnionTypes() : [type];
    return members.some(isNullish) ? undefined : SET;
  }
  const token = literalToken(type);
  return token !== undefined && allTokens(field).has(token) ? token : undefined;
};

export const assignedValue = (value: Expression, field: StateField): AssignedValues => {
  const token = tokenOfAssigned(value, field);
  return token === undefined ? UNRESOLVED : assignedToken(token);
};

const isDestructuringTarget = (node: Node): boolean =>
  Node.isObjectLiteralExpression(node) || Node.isArrayLiteralExpression(node);

const STATE_HOLDER = 'props';

const writesFieldOrHolder = (target: Node, field: StateField): boolean => {
  const name = fieldNameOf(target);
  return name === field.name || name === STATE_HOLDER;
};

const destructuresInto = (target: Node, field: StateField): boolean =>
  [target, ...target.getDescendants()].some((candidate) => writesFieldOrHolder(candidate, field));

const destructuresIntoState = (target: Node): boolean => [target, ...target.getDescendants()].some(isRootedAtThis);

const isUnresolvedAssignment = (binary: BinaryExpression, field: StateField): boolean => {
  const target = unwrap(binary.getLeft());
  if (isDestructuringTarget(target)) return destructuresInto(target, field);
  const name = fieldNameOf(target);
  if (name === STATE_HOLDER) return true;
  const isPlainAssignment = binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken;
  return name === field.name && !isPlainAssignment;
};

const mayWriteThroughDestructuring = (binary: BinaryExpression): boolean => {
  const target = unwrap(binary.getLeft());
  return isDestructuringTarget(target) && destructuresIntoState(target);
};

const isAssignmentTarget = (node: Node): boolean => {
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isBinaryExpression(parent)) return isAssignmentOperator(parent) && parent.getLeft() === node;
  return unwrap(parent) !== parent && isAssignmentTarget(parent);
};

const escapesIn = (scope: Node): boolean =>
  [scope, ...scope.getDescendants()].some((node) => escapesStateHolder(node) && !isAssignmentTarget(node));

export const setsOf = (scope: Node, field: StateField): AssignedValues => {
  const assignments = scope.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter(isAssignmentOperator);
  const direct = assignments
    .filter((binary) => binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken)
    .filter((binary) => fieldNameOf(unwrap(binary.getLeft())) === field.name)
    .map((binary) => assignedValue(binary.getRight(), field));
  const unresolved = assignments.some((binary) => isUnresolvedAssignment(binary, field));
  const mayWrite = escapesIn(scope) || assignments.some(mayWriteThroughDestructuring);
  return mergeAssigned([...direct, ...(unresolved ? [UNRESOLVED] : []), ...(mayWrite ? [MAY_WRITE] : [])]);
};
