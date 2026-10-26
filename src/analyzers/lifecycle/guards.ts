import {
  BinaryExpression,
  Expression,
  IfStatement,
  MethodDeclaration,
  Node,
  Statement,
  Symbol as MorphSymbol,
  SyntaxKind,
} from 'ts-morph';
import { AggregateScope, fieldNameOf, referencesFieldDirectly } from './field-ref';
import { evaluateCondition } from './guard-condition';
import { collapseGuardTokens, guardUniverse } from './guard-tokens';
import { Sources, StateField } from './model';
import { isLibraryNode } from '../shared/library';
import { isAccessor } from './state-field';
import { intersect } from './values';

type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

const exitsEarly = (statement: Statement): boolean => {
  const statements = Node.isBlock(statement) ? statement.getStatements() : [statement];
  const [only] = statements;
  if (statements.length !== 1) return false;
  if (Node.isReturnStatement(only) || Node.isThrowStatement(only)) return true;
  if (!Node.isExpressionStatement(only)) return false;
  const expression = only.getExpression();
  if (!Node.isCallExpression(expression)) return false;
  const calleeName = expression.getExpression().getText().split('.').pop() ?? '';
  return /^throw/i.test(calleeName);
};

const leavesEarly = (statement: Statement): boolean =>
  [statement, ...statement.getDescendants()].some((node) => Node.isReturnStatement(node) || Node.isThrowStatement(node));

const wrappingGuard = (statements: readonly Statement[]): IfStatement | undefined => {
  const [only] = statements;
  return statements.length === 1 &&
    Node.isIfStatement(only) &&
    only.getElseStatement() === undefined &&
    !leavesEarly(only.getThenStatement())
    ? only
    : undefined;
};

const scanWrapper = (wrapper: IfStatement, field: StateField, scope: AggregateScope): GuardScan => {
  const evaluation = evaluateCondition(wrapper.getExpression(), field, scope);
  const then = wrapper.getThenStatement();
  const inner = scanStatements(Node.isBlock(then) ? then.getStatements() : [then], field, scope);
  if (evaluation === 'unknown' || inner === 'unknown') return 'unknown';
  return {
    allowed: intersect(evaluation.whenTrue, inner.allowed),
    recognised: new Set([wrapper.getExpression(), ...inner.recognised]),
  };
};

const scanEarlyExits = (statements: readonly Statement[], field: StateField, scope: AggregateScope): GuardScan =>
  statements
    .filter(Node.isIfStatement)
    .filter((statement) => statement.getElseStatement() === undefined && exitsEarly(statement.getThenStatement()))
    .reduce<GuardScan>(
      (scan, guard) => {
        if (scan === 'unknown') return scan;
        const evaluation = evaluateCondition(guard.getExpression(), field, scope);
        if (evaluation === 'unknown') return 'unknown';
        return {
          allowed: intersect(scan.allowed, evaluation.whenFalse),
          recognised: new Set([...scan.recognised, guard.getExpression()]),
        };
      },
      { allowed: guardUniverse(field), recognised: new Set<Node>() },
    );

const scanStatements = (statements: readonly Statement[], field: StateField, scope: AggregateScope): GuardScan => {
  const wrapper = wrappingGuard(statements);
  return wrapper ? scanWrapper(wrapper, field, scope) : scanEarlyExits(statements, field, scope);
};

const isFieldAssignment = (node: Node, field: StateField): node is BinaryExpression =>
  Node.isBinaryExpression(node) &&
  node.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
  fieldNameOf(node.getLeft()) === field.name;

const readsFieldOutside = (
  node: Node,
  field: StateField,
  scope: AggregateScope,
  recognised: ReadonlySet<Node>,
): boolean => {
  if (recognised.has(node)) return false;
  if (isFieldAssignment(node, field)) return readsFieldOutside(node.getRight(), field, scope, recognised);
  return (
    referencesFieldDirectly(node, field.name, scope) ||
    node.forEachChildAsArray().some((child) => readsFieldOutside(child, field, scope, recognised))
  );
};

const unwrapParentheses = (node: Expression): Expression =>
  Node.isParenthesizedExpression(node) ? unwrapParentheses(node.getExpression()) : node;

const assignedMember = (target: Expression): MorphSymbol | undefined => {
  if (Node.isPropertyAccessExpression(target)) return target.getNameNode().getSymbol();
  if (Node.isElementAccessExpression(target)) return target.getArgumentExpression()?.getSymbol();
  return undefined;
};

const isPlainDataMember = (symbol: MorphSymbol | undefined): boolean => {
  const declarations = symbol?.getDeclarations() ?? [];
  return declarations.length > 0 && !declarations.some(isAccessor) && !declarations.some(isLibraryNode);
};

const isPlainDataPathFromThis = (target: Expression): boolean => {
  if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return false;
  const holder = target.getExpression();
  return (
    isPlainDataMember(assignedMember(target)) && (Node.isThisExpression(holder) || isPlainDataPathFromThis(holder))
  );
};

const overwritesField = (statement: Statement, field: StateField): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = unwrapParentheses(statement.getExpression());
  return isFieldAssignment(expression, field) && isPlainDataPathFromThis(expression.getLeft());
};

const statementsUntilOverwrite = (statements: readonly Statement[], field: StateField): readonly Statement[] => {
  const overwrite = statements.findIndex((statement) => overwritesField(statement, field));
  return overwrite === -1 ? statements : statements.slice(0, overwrite + 1);
};

export const methodSources = (method: MethodDeclaration, field: StateField, scope: AggregateScope): Sources => {
  const body = method.getBody();
  if (!Node.isBlock(body)) return { kind: 'unknown' };
  const considered = statementsUntilOverwrite(body.getStatements(), field);
  const scan = scanStatements(considered, field, scope);
  if (scan === 'unknown') return { kind: 'unknown' };
  return considered.some((statement) => readsFieldOutside(statement, field, scope, scan.recognised))
    ? { kind: 'unknown' }
    : collapseGuardTokens(field, scan.allowed);
};
