import { Node, Statement } from 'ts-morph';

export type ExitKind = 'any' | 'throw';

export const branchStatements = (statement: Statement): readonly Statement[] =>
  Node.isBlock(statement) ? statement.getStatements() : [statement];

const isThrowingCall = (statement: Statement): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = statement.getExpression();
  if (!Node.isCallExpression(expression)) return false;
  const calleeName = expression.getExpression().getText().split('.').pop() ?? '';
  return /^throw/i.test(calleeName);
};

const isExit = (statement: Statement, exits: ExitKind): boolean =>
  Node.isThrowStatement(statement) ||
  isThrowingCall(statement) ||
  (exits === 'any' && Node.isReturnStatement(statement));

export const isEarlyExit = (statements: readonly Statement[], exits: ExitKind): boolean => {
  const [only] = statements;
  return statements.length === 1 && only !== undefined && isExit(only, exits);
};

export const exitsEarly = (statement: Statement, exits: ExitKind): boolean => isEarlyExit(branchStatements(statement), exits);

export const containsReturnOrThrow = (statement: Statement): boolean =>
  [statement, ...statement.getDescendants()].some((node) => Node.isReturnStatement(node) || Node.isThrowStatement(node));
