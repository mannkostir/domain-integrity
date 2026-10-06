import { Decorator, Node } from 'ts-morph';

const referenceName = (expression: Node): string | undefined => {
  if (Node.isIdentifier(expression)) return expression.getText();
  return Node.isPropertyAccessExpression(expression) ? expression.getName() : undefined;
};

export const decoratorName = (decorator: Decorator): string | undefined => {
  const expression = decorator.getExpression();
  return Node.isCallExpression(expression) ? referenceName(expression.getExpression()) : referenceName(expression);
};
