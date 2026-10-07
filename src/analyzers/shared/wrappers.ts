import { Node } from 'ts-morph';

export const unwrap = (node: Node): Node =>
  Node.isNonNullExpression(node) ||
  Node.isParenthesizedExpression(node) ||
  Node.isAsExpression(node) ||
  Node.isTypeAssertion(node) ||
  Node.isSatisfiesExpression(node)
    ? unwrap(node.getExpression())
    : node;

export const outermostWrapper = (node: Node): Node => {
  const parent = node.getParent();
  return parent !== undefined && unwrap(parent) !== parent && unwrap(parent) === unwrap(node) ? outermostWrapper(parent) : node;
};
