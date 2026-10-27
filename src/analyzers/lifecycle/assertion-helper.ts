import { MethodDeclaration, Node, PropertyAccessExpression, Statement } from 'ts-morph';
import { isLibraryNode } from '../shared/library';
import { AggregateScope, thisMethodDeclaration } from './field-ref';
import { GuardRules, GuardScan, ScanGuards, mayAssignField, readsFieldOutside } from './guard-scan';
import { StateField } from './model';

const MAX_HELPER_DEPTH = 5;

const thisCallee = (statement: Statement): PropertyAccessExpression | undefined => {
  if (!Node.isExpressionStatement(statement)) return undefined;
  const call = statement.getExpression();
  if (!Node.isCallExpression(call) || call.hasQuestionDotToken()) return undefined;
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) &&
    !callee.hasQuestionDotToken() &&
    Node.isThisExpression(callee.getExpression())
    ? callee
    : undefined;
};

const isPlainInstanceMethod = (method: MethodDeclaration): boolean =>
  !isLibraryNode(method) &&
  !method.isStatic() &&
  !method.isAbstract() &&
  !method.isAsync() &&
  !method.isGenerator() &&
  !method.isOverload();

const helperStatements = (method: MethodDeclaration, rules: GuardRules): readonly Statement[] | undefined => {
  const body = method.getBody();
  const expandable = rules.helpers.length < MAX_HELPER_DEPTH && !rules.helpers.includes(method);
  return expandable && isPlainInstanceMethod(method) && Node.isBlock(body) ? body.getStatements() : undefined;
};

const helperRules = (method: MethodDeclaration, rules: GuardRules): GuardRules => ({
  exits: 'throw',
  strict: true,
  helpers: [...rules.helpers, method],
});

const readsOutsideHelper = (
  method: MethodDeclaration,
  statements: readonly Statement[],
  field: StateField,
  scope: AggregateScope,
  recognised: ReadonlySet<Node>,
): boolean =>
  [...method.getParameters(), ...statements].some((node) => readsFieldOutside(node, field, scope, recognised));

const scanHelperCall = (
  callee: PropertyAccessExpression,
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
  scanGuards: ScanGuards,
): GuardScan | undefined => {
  const method = thisMethodDeclaration(callee, scope.cls);
  const statements = method === undefined ? undefined : helperStatements(method, rules);
  if (method === undefined || statements === undefined) return undefined;
  const scan = scanGuards(statements, field, scope, helperRules(method, rules));
  return scan === 'unknown' || readsOutsideHelper(method, statements, field, scope, scan.recognised)
    ? undefined
    : { allowed: scan.allowed, recognised: new Set([callee]) };
};

export const scanHelperStep = (
  statement: Statement,
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
  scanGuards: ScanGuards,
): GuardScan | undefined => {
  const callee = thisCallee(statement);
  const helper = callee === undefined ? undefined : scanHelperCall(callee, field, scope, rules, scanGuards);
  return helper !== undefined && mayAssignField(statement, field) ? 'unknown' : helper;
};
