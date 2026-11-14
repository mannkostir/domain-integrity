import { Node, Type } from 'ts-morph';
import { unwrap } from '../../shared/wrappers';
import { keyNames } from '../../shared/writes';
import { MAX_PROJECTION_DEPTH } from './model';

export const originalExpressionType = (expression: Node, depth = 0): Type => {
  const node = unwrap(expression);
  if (depth >= MAX_PROJECTION_DEPTH) return node.getType();
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    const names = Node.isPropertyAccessExpression(node) ? [node.getName()] : keyNames(node.getArgumentExpression());
    const name = names.length === 1 ? names[0] : undefined;
    const receiver = originalExpressionType(node.getExpression(), depth + 1).getNonNullableType();
    const member = name === undefined ? undefined : receiver.getProperty(name);
    if (member !== undefined) return member.getTypeAtLocation(node);
  }
  return node.getType();
};
