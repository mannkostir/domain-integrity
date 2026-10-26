import { Node, Statement } from 'ts-morph';

export const branchStatements = (statement: Statement): readonly Statement[] =>
  Node.isBlock(statement) ? statement.getStatements() : [statement];

export const isEarlyExit = (statements: readonly Statement[]): boolean => {
  const [only] = statements;
  if (statements.length !== 1) return false;
  if (Node.isReturnStatement(only) || Node.isThrowStatement(only)) return true;
  if (!Node.isExpressionStatement(only)) return false;
  const expression = only.getExpression();
  if (!Node.isCallExpression(expression)) return false;
  const calleeName = expression.getExpression().getText().split('.').pop() ?? '';
  return /^throw/i.test(calleeName);
};

export const exitsEarly = (statement: Statement): boolean => isEarlyExit(branchStatements(statement));

export const containsReturnOrThrow = (statement: Statement): boolean =>
  [statement, ...statement.getDescendants()].some((node) => Node.isReturnStatement(node) || Node.isThrowStatement(node));
