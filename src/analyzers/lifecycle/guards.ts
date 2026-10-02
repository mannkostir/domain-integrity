import {
  BinaryExpression,
  Expression,
  IfStatement,
  MethodDeclaration,
  Node,
  Statement,
  SyntaxKind,
} from 'ts-morph';
import { SET, UNSET, literalToken } from '../../engine/value-token';
import { AggregateScope, fieldNameOf, referencesField, referencesFieldDirectly, thisGetterExpression } from './field-ref';
import { Sources, StateField } from './model';
import { allTokens, difference, intersect, union } from './values';

type Evaluation = { readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> } | 'unknown';

type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

const MAX_GETTER_DEPTH = 5;
const EQUALITY = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken]);
const INEQUALITY = new Set<SyntaxKind>([SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);

const negate = (evaluation: Evaluation): Evaluation =>
  evaluation === 'unknown' ? evaluation : { whenTrue: evaluation.whenFalse, whenFalse: evaluation.whenTrue };

const truthiness = (field: StateField): Evaluation => {
  if (field.kind === 'boolean') return { whenTrue: new Set(['true']), whenFalse: new Set(['false']) };
  if (field.kind === 'nullable') return { whenTrue: new Set([SET]), whenFalse: new Set([UNSET]) };
  return 'unknown';
};

const comparedToken = (node: Expression, field: StateField): string | undefined => {
  if (field.kind === 'nullable') return Node.isNullLiteral(node) || node.getText() === 'undefined' ? UNSET : undefined;
  const token = literalToken(node.getType());
  return token !== undefined && allTokens(field).has(token) ? token : undefined;
};

const comparedSide = (left: Expression, right: Expression, field: StateField): Expression | undefined => {
  if (fieldNameOf(left) === field.name) return right;
  if (fieldNameOf(right) === field.name) return left;
  return undefined;
};

const compare = (left: Expression, right: Expression, field: StateField): Evaluation => {
  const other = comparedSide(left, right, field);
  const token = other === undefined ? undefined : comparedToken(other, field);
  if (token === undefined) return 'unknown';
  const matching = new Set([token]);
  return { whenTrue: matching, whenFalse: difference(allTokens(field), matching) };
};

const evaluateBinary = (node: BinaryExpression, field: StateField, scope: AggregateScope, depth: number): Evaluation => {
  const operator = node.getOperatorToken().getKind();
  if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
    const left = evaluate(node.getLeft(), field, scope, depth);
    const right = evaluate(node.getRight(), field, scope, depth);
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return operator === SyntaxKind.AmpersandAmpersandToken
      ? { whenTrue: intersect(left.whenTrue, right.whenTrue), whenFalse: union(left.whenFalse, right.whenFalse) }
      : { whenTrue: union(left.whenTrue, right.whenTrue), whenFalse: intersect(left.whenFalse, right.whenFalse) };
  }
  if (EQUALITY.has(operator)) return compare(node.getLeft(), node.getRight(), field);
  if (INEQUALITY.has(operator)) return negate(compare(node.getLeft(), node.getRight(), field));
  return 'unknown';
};

const evaluate = (node: Expression, field: StateField, scope: AggregateScope, depth = 0): Evaluation => {
  if (!referencesField(node, field.name, scope)) return { whenTrue: allTokens(field), whenFalse: allTokens(field) };
  if (Node.isParenthesizedExpression(node)) return evaluate(node.getExpression(), field, scope, depth);
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
    return negate(evaluate(node.getOperand(), field, scope, depth));
  }
  if (Node.isBinaryExpression(node)) return evaluateBinary(node, field, scope, depth);
  if (fieldNameOf(node) === field.name) return truthiness(field);
  const getter = depth < MAX_GETTER_DEPTH ? thisGetterExpression(node, scope.cls) : undefined;
  return getter === undefined ? 'unknown' : evaluate(getter, field, scope, depth + 1);
};

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
  const evaluation = evaluate(wrapper.getExpression(), field, scope);
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
        const evaluation = evaluate(guard.getExpression(), field, scope);
        if (evaluation === 'unknown') return 'unknown';
        return {
          allowed: intersect(scan.allowed, evaluation.whenFalse),
          recognised: new Set([...scan.recognised, guard.getExpression()]),
        };
      },
      { allowed: allTokens(field), recognised: new Set<Node>() },
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

export const methodSources = (method: MethodDeclaration, field: StateField, scope: AggregateScope): Sources => {
  const body = method.getBody();
  if (!Node.isBlock(body)) return { kind: 'unknown' };
  const scan = scanStatements(body.getStatements(), field, scope);
  if (scan === 'unknown') return { kind: 'unknown' };
  return readsFieldOutside(body, field, scope, scan.recognised)
    ? { kind: 'unknown' }
    : { kind: 'known', values: scan.allowed };
};
