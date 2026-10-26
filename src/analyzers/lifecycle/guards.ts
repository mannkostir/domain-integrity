import {
  BinaryExpression,
  Expression,
  IfStatement,
  MethodDeclaration,
  Node,
  PropertyAccessExpression,
  Statement,
  SwitchStatement,
  Symbol as MorphSymbol,
  SyntaxKind,
} from 'ts-morph';
import { ExitKind, branchStatements, exitsEarly, containsReturnOrThrow } from './early-exit';
import { AggregateScope, fieldNameOf, referencesFieldDirectly, thisMethodDeclaration } from './field-ref';
import { evaluateCondition } from './guard-condition';
import { collapseGuardTokens, guardUniverse } from './guard-tokens';
import { Sources, StateField } from './model';
import { isLibraryNode } from '../shared/library';
import { isAccessor } from './state-field';
import { FieldSwitch, SwitchGroup, isFieldSwitch, readFieldSwitch } from './switch-guard';
import { difference, intersect, union } from './values';

type GuardScan = { readonly allowed: ReadonlySet<string>; readonly recognised: ReadonlySet<Node> } | 'unknown';

type ExitGuard = {
  readonly condition: Expression;
  readonly passesWhen: 'whenTrue' | 'whenFalse';
  readonly continuation: readonly Statement[];
};

type GuardRules = {
  readonly exits: ExitKind;
  readonly strict: boolean;
  readonly helpers: readonly MethodDeclaration[];
};

const METHOD_RULES: GuardRules = { exits: 'any', strict: false, helpers: [] };

const MAX_HELPER_DEPTH = 5;

const exitGuard = (statement: Statement, exits: ExitKind): ExitGuard | undefined => {
  if (!Node.isIfStatement(statement)) return undefined;
  const condition = statement.getExpression();
  const then = statement.getThenStatement();
  const otherwise = statement.getElseStatement();
  const thenExits = exitsEarly(then, exits);
  if (otherwise === undefined) return thenExits ? { condition, passesWhen: 'whenFalse', continuation: [] } : undefined;
  if (thenExits === exitsEarly(otherwise, exits)) return undefined;
  return thenExits
    ? { condition, passesWhen: 'whenFalse', continuation: branchStatements(otherwise) }
    : { condition, passesWhen: 'whenTrue', continuation: branchStatements(then) };
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

const assignsField = (statement: Statement, field: StateField): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = unwrapParentheses(statement.getExpression());
  return isFieldAssignment(expression, field) && isPlainDataPathFromThis(expression.getLeft());
};

const overwritesField = (statement: Statement, field: StateField): boolean =>
  assignsField(statement, field) ||
  (exitGuard(statement, 'any')?.continuation.some((inner) => overwritesField(inner, field)) ?? false);

const statementsUntilOverwrite = (statements: readonly Statement[], field: StateField): readonly Statement[] => {
  const overwrite = statements.findIndex((statement) => overwritesField(statement, field));
  return overwrite === -1 ? statements : statements.slice(0, overwrite + 1);
};

const wrappingGuard = (statements: readonly Statement[]): IfStatement | undefined => {
  const [only] = statements;
  return statements.length === 1 &&
    Node.isIfStatement(only) &&
    only.getElseStatement() === undefined &&
    !containsReturnOrThrow(only.getThenStatement())
    ? only
    : undefined;
};

const scanWrapper = (wrapper: IfStatement, field: StateField, scope: AggregateScope): GuardScan => {
  const evaluation = evaluateCondition(wrapper.getExpression(), field, scope);
  const body = branchStatements(wrapper.getThenStatement());
  const considered = statementsUntilOverwrite(body, field);
  const inner = scanStatements(considered, field, scope);
  if (evaluation === 'unknown' || inner === 'unknown') return 'unknown';
  return {
    allowed: intersect(evaluation.whenTrue, inner.allowed),
    recognised: new Set([wrapper.getExpression(), ...inner.recognised, ...body.slice(considered.length)]),
  };
};

const narrow = (scan: GuardScan, step: GuardScan): GuardScan =>
  scan === 'unknown' || step === 'unknown'
    ? 'unknown'
    : { allowed: intersect(scan.allowed, step.allowed), recognised: new Set([...scan.recognised, ...step.recognised]) };

const scanExitGuard = (guard: ExitGuard, field: StateField, scope: AggregateScope, rules: GuardRules): GuardScan => {
  const evaluation = evaluateCondition(guard.condition, field, scope);
  if (evaluation === 'unknown') return 'unknown';
  const continuation = scanEarlyExits(statementsUntilOverwrite(guard.continuation, field), field, scope, rules);
  return narrow({ allowed: evaluation[guard.passesWhen], recognised: new Set([guard.condition]) }, continuation);
};

const switchExcludingExits = (read: FieldSwitch, field: StateField): GuardScan => {
  if (read.groups.some((group) => group.kind === 'work')) return 'unknown';
  const exits = read.groups
    .filter((group) => group.kind === 'exit')
    .reduce<ReadonlySet<string>>((all, group) => union(all, group.tokens), new Set());
  return { allowed: difference(guardUniverse(field), exits), recognised: new Set(read.recognised) };
};

const scanSwitchStep = (statement: SwitchStatement, field: StateField, scope: AggregateScope, exits: ExitKind): GuardScan => {
  const read = readFieldSwitch(statement, field, scope, exits);
  return read === 'unknown' ? read : switchExcludingExits(read, field);
};

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
): GuardScan | undefined => {
  const method = thisMethodDeclaration(callee, scope.cls);
  const statements = method === undefined ? undefined : helperStatements(method, rules);
  if (method === undefined || statements === undefined) return undefined;
  const scan = scanEarlyExits(statements, field, scope, helperRules(method, rules));
  return scan === 'unknown' || readsOutsideHelper(method, statements, field, scope, scan.recognised)
    ? undefined
    : { allowed: scan.allowed, recognised: new Set([callee]) };
};

const mayAssignField = (statement: Statement, field: StateField): boolean =>
  [statement, ...statement.getDescendants()].some((node) => isFieldAssignment(node, field));

const scanHelperStep = (
  statement: Statement,
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
): GuardScan | undefined => {
  const callee = thisCallee(statement);
  const helper = callee === undefined ? undefined : scanHelperCall(callee, field, scope, rules);
  return helper !== undefined && mayAssignField(statement, field) ? 'unknown' : helper;
};

const scanExitStep = (
  statement: Statement,
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
): GuardScan | undefined => {
  const guard = exitGuard(statement, rules.exits);
  if (guard !== undefined) return scanExitGuard(guard, field, scope, rules);
  if (isFieldSwitch(statement, field)) return scanSwitchStep(statement, field, scope, rules.exits);
  return scanHelperStep(statement, field, scope, rules);
};

const scanEarlyExits = (
  statements: readonly Statement[],
  field: StateField,
  scope: AggregateScope,
  rules: GuardRules,
): GuardScan =>
  statements.reduce<GuardScan>(
    (scan, statement, index) => {
      if (scan === 'unknown') return scan;
      const step = scanExitStep(statement, field, scope, rules);
      if (step === undefined) return rules.strict ? 'unknown' : scan;
      const followsWrite = statements.slice(0, index).some((earlier) => mayAssignField(earlier, field));
      return followsWrite ? 'unknown' : narrow(scan, step);
    },
    { allowed: guardUniverse(field), recognised: new Set<Node>() },
  );

const soleFieldSwitch = (statements: readonly Statement[], field: StateField): SwitchStatement | undefined => {
  const [only] = statements;
  return statements.length === 1 && only !== undefined && isFieldSwitch(only, field) ? only : undefined;
};

const scanWorkGroup = (group: SwitchGroup, field: StateField, scope: AggregateScope): GuardScan => {
  const inner = scanStatements(statementsUntilOverwrite(group.work, field), field, scope);
  return inner === 'unknown' ? inner : { allowed: intersect(group.tokens, inner.allowed), recognised: inner.recognised };
};

const joinWorkGroups = (scan: GuardScan, inner: GuardScan): GuardScan =>
  scan === 'unknown' || inner === 'unknown'
    ? 'unknown'
    : { allowed: union(scan.allowed, inner.allowed), recognised: new Set([...scan.recognised, ...inner.recognised]) };

const scanSwitchWrapper = (statement: SwitchStatement, field: StateField, scope: AggregateScope): GuardScan => {
  const read = readFieldSwitch(statement, field, scope, METHOD_RULES.exits);
  if (read === 'unknown') return read;
  const workGroups = read.groups.filter((group) => group.kind === 'work');
  if (workGroups.length === 0) return switchExcludingExits(read, field);
  return workGroups
    .map((group) => scanWorkGroup(group, field, scope))
    .reduce<GuardScan>(joinWorkGroups, { allowed: new Set<string>(), recognised: new Set(read.recognised) });
};

const scanStatements = (statements: readonly Statement[], field: StateField, scope: AggregateScope): GuardScan => {
  const wrapper = wrappingGuard(statements);
  if (wrapper) return scanWrapper(wrapper, field, scope);
  const fieldSwitch = soleFieldSwitch(statements, field);
  return fieldSwitch ? scanSwitchWrapper(fieldSwitch, field, scope) : scanEarlyExits(statements, field, scope, METHOD_RULES);
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
