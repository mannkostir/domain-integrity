import { BinaryExpression, MethodDeclaration, Node, Statement, SyntaxKind } from 'ts-morph';
import { ExitKind } from './early-exit';
import { AggregateScope, fieldNameOf, referencesFieldDirectly } from './field-ref';
import { StateField } from './model';

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
