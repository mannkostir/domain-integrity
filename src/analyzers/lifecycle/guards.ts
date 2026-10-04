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
import { SET, literalToken } from '../../engine/value-token';
import { AggregateScope, fieldNameOf, referencesField, referencesFieldDirectly, thisGetterExpression } from './field-ref';
import { collapseGuardTokens, comparedUnsetTokens, guardUniverse, unsetGuardTokens } from './guard-tokens';
import { Sources, StateField, UnsetForm } from './model';
import { isLibraryNode } from './library';
import { isAccessor } from './state-field';
import { allTokens, difference, intersect, union } from './values';

type Evaluation = { readonly whenTrue: ReadonlySet<string>; readonly whenFalse: ReadonlySet<string> } | 'unknown';

type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

const MAX_GETTER_DEPTH = 5;
const EQUALITY = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.EqualsEqualsToken]);
const INEQUALITY = new Set<SyntaxKind>([SyntaxKind.ExclamationEqualsEqualsToken, SyntaxKind.ExclamationEqualsToken]);
const STRICT = new Set<SyntaxKind>([SyntaxKind.EqualsEqualsEqualsToken, SyntaxKind.ExclamationEqualsEqualsToken]);

const negate = (evaluation: Evaluation): Evaluation =>
  evaluation === 'unknown' ? evaluation : { whenTrue: evaluation.whenFalse, whenFalse: evaluation.whenTrue };

const truthiness = (field: StateField): Evaluation => {
  if (field.kind === 'boolean') return { whenTrue: new Set(['true']), whenFalse: new Set(['false']) };
  if (field.kind === 'nullable' && !field.setMayBeFalsy) return { whenTrue: new Set([SET]), whenFalse: unsetGuardTokens(field) };
  return 'unknown';
};

const unsetFormOf = (node: Expression): UnsetForm | undefined => {
  if (Node.isNullLiteral(node)) return 'null';
  return node.getText() === 'undefined' ? 'undefined' : undefined;
};

const comparedTokens = (node: Expression, field: StateField, strict: boolean): ReadonlySet<string> | undefined => {
  if (field.kind === 'nullable') {
    const form = unsetFormOf(node);
    return form === undefined ? undefined : comparedUnsetTokens(field, form, strict);
  }
  const token = literalToken(node.getType());
  return token !== undefined && allTokens(field).has(token) ? new Set([token]) : undefined;
};

const comparedSide = (left: Expression, right: Expression, field: StateField): Expression | undefined => {
  if (fieldNameOf(left) === field.name) return right;
  if (fieldNameOf(right) === field.name) return left;
  return undefined;
};

const compare = (left: Expression, right: Expression, field: StateField, strict: boolean): Evaluation => {
  const other = comparedSide(left, right, field);
  const matching = other === undefined ? undefined : comparedTokens(other, field, strict);
  if (matching === undefined) return 'unknown';
  return { whenTrue: matching, whenFalse: difference(guardUniverse(field), matching) };
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
  const strict = STRICT.has(operator);
  if (EQUALITY.has(operator)) return compare(node.getLeft(), node.getRight(), field, strict);
  if (INEQUALITY.has(operator)) return negate(compare(node.getLeft(), node.getRight(), field, strict));
  return 'unknown';
};

const evaluate = (node: Expression, field: StateField, scope: AggregateScope, depth = 0): Evaluation => {
  if (!referencesField(node, field.name, scope)) return { whenTrue: guardUniverse(field), whenFalse: guardUniverse(field) };
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
