import { BinaryExpression, MethodDeclaration, Node, Statement, SyntaxKind } from 'ts-morph';
import { ExitKind } from './early-exit';
import { AggregateScope, MAX_GETTER_DEPTH, fieldNameOf, referencesFieldDirectly, thisGetterExpression } from './field-ref';
import { StateField } from './model';
import { isWritten } from '../shared/writes';
import { outermostWrapper } from '../shared/wrappers';

export type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

export type GuardRules = {
  readonly exits: ExitKind;
  readonly strict: boolean;
  readonly helpers: readonly MethodDeclaration[];
};

export type ScanGuards = (
  statements: readonly Statement[],
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
) => GuardScan;

export const isFieldAssignment = (node: Node, field: StateField): node is BinaryExpression =>
  Node.isBinaryExpression(node) &&
  node.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
  fieldNameOf(node.getLeft()) === field.name;

export const readsFieldOutside = (
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

export const mayAssignField = (statement: Statement, field: StateField): boolean =>
  [statement, ...statement.getDescendants()].some((node) => isFieldAssignment(node, field));

const isReadOnly = (node: Node): boolean => !isWritten(outermostWrapper(node));

const isPlainFieldRead = (node: Node, field: StateField): boolean => fieldNameOf(node) === field.name && isReadOnly(node);

const writesField = (node: Node, field: StateField): boolean =>
  [node, ...node.getDescendants()].some((candidate) => fieldNameOf(candidate) === field.name && !isReadOnly(candidate));

const isPlainGetterRead = (node: Node, field: StateField, scope: AggregateScope, depth: number): boolean => {
  const expression = depth < MAX_GETTER_DEPTH ? thisGetterExpression(node, scope.cls) : undefined;
  return (
    expression !== undefined &&
    isReadOnly(node) &&
    !writesField(expression, field) &&
    !readsFieldOutside(expression, field, scope, new Set(plainFieldReads(expression, field, scope, depth + 1)))
  );
};

const plainFieldReads = (node: Node, field: StateField, scope: AggregateScope, depth: number): readonly Node[] =>
  [node, ...node.getDescendants()].filter(
    (candidate) => isPlainFieldRead(candidate, field) || isPlainGetterRead(candidate, field, scope, depth),
  );

const isExitStatement = (statement: Statement): boolean => Node.isReturnStatement(statement) || Node.isThrowStatement(statement);

export const exitFieldReads = (statements: readonly Statement[], field: StateField, scope: AggregateScope): readonly Node[] =>
  statements
    .filter((statement) => isExitStatement(statement) && !writesField(statement, field))
    .flatMap((statement) => plainFieldReads(statement, field, scope, 0));
