import { BinaryExpression, Node, Statement, SyntaxKind } from 'ts-morph';
import { ExitKind } from './early-exit';
import { AggregateScope, fieldNameOf, referencesFieldDirectly, scalarCallable } from './field-ref';
import { MethodImplementation } from './instance-method';
import { setterStateAssignment } from './state-assignment';
import { ScalarReturnProof } from './scalar-callable';
import { StateField } from './model';
import { isWritten } from '../shared/writes';
import { outermostWrapper } from '../shared/wrappers';

export type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

export type GuardRules = {
  readonly exits: ExitKind;
  readonly strict: boolean;
  readonly helpers: readonly MethodImplementation[];
};

export type ScanGuards = (
  statements: readonly Statement[],
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
) => GuardScan;

export const isFieldAssignment = (node: Node, field: StateField, scope: AggregateScope): node is BinaryExpression =>
  Node.isBinaryExpression(node) &&
  node.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
  ((fieldNameOf(node.getLeft()) === field.name &&
    (scope.projections?.projection(field.name) === undefined || scope.projections.receiver(node.getLeft(), field.name))) ||
    setterStateAssignment(node, field.name, scope.cls, scope.javascriptData) !== undefined);

export const readsFieldOutside = (
  node: Node,
  field: StateField,
  scope: AggregateScope,
  recognised: ReadonlySet<Node>,
): boolean => {
  if (recognised.has(node)) return false;
  if (isFieldAssignment(node, field, scope)) return readsFieldOutside(node.getRight(), field, scope, recognised);
  return (
    referencesFieldDirectly(node, field.name, scope) ||
    node.forEachChildAsArray().some((child) => readsFieldOutside(child, field, scope, recognised))
  );
};

export const mayAssignField = (statement: Statement, field: StateField, scope: AggregateScope): boolean =>
  [statement, ...statement.getDescendants()].some((node) => isFieldAssignment(node, field, scope));

const isReadOnly = (node: Node): boolean => !isWritten(outermostWrapper(node));

const isPlainFieldRead = (node: Node, field: StateField, scope: AggregateScope): boolean =>
  isReadOnly(node) && (scope.projections?.projection(field.name) !== undefined
    ? scope.projections.scalar(node, field.name) : fieldNameOf(node) === field.name);

const writesField = (node: Node, field: StateField, scope: AggregateScope): boolean =>
  [node, ...node.getDescendants()].some((candidate) =>
    (fieldNameOf(candidate) === field.name && !isReadOnly(candidate)) || isFieldAssignment(candidate, field, scope));

const plainFieldReads = (node: Node, field: StateField, scope: AggregateScope): readonly Node[] => {
  const proof = new ScalarReturnProof(field, scope);
  const recognised = [node, ...node.getDescendants()].filter(candidate =>
    isPlainFieldRead(candidate, field, scope) ||
    (isReadOnly(candidate) && scalarCallable(candidate, scope) !== undefined && proof.expand(candidate) !== undefined));
  return proof.valid() ? recognised : [];
};

const isExitStatement = (statement: Statement): boolean => Node.isReturnStatement(statement) || Node.isThrowStatement(statement);

export const exitFieldReads = (statements: readonly Statement[], field: StateField, scope: AggregateScope): readonly Node[] =>
  statements
    .filter((statement) => isExitStatement(statement) && !writesField(statement, field, scope))
    .flatMap((statement) => plainFieldReads(statement, field, scope));
