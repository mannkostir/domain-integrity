import { BinaryExpression, ClassDeclaration, ClassExpression, Node, SyntaxKind } from 'ts-morph';
import { isAssignmentTarget, setsOf } from './assigned';
import { AggregateScope, escapesStateHolder, fieldNameOf, isComputedStateAccess, memberName } from './field-ref';
import { instanceAccessors, instanceMethods, projectAncestry } from './members';
import { AssignedValues, StateField } from './model';
import { outsideAssignments } from './outside';
import { hasUnknownWrite } from './values';
import { SourceIndex } from '../shared/source-index';
import { unwrap } from '../shared/wrappers';

type ClassLike = ClassDeclaration | ClassExpression;

type Assignment = { readonly binary: BinaryExpression; readonly target: Node };

const mayChange = (value: AssignedValues): boolean => value.tokens.size > 0 || hasUnknownWrite(value);

const writtenByAny = (accessors: readonly Node[], field: StateField): boolean =>
  accessors.some((accessor) => mayChange(setsOf(accessor, field)));

const writtenOutsideClass = (sources: SourceIndex, cls: ClassDeclaration, field: StateField, root: string): boolean =>
  outsideAssignments(sources, cls, field, root).length > 0;

const isAssignment = (binary: BinaryExpression): boolean => {
  const operator = binary.getOperatorToken().getKind();
  return operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment;
};

const isMemberAccess = (node: Node): boolean => Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node);

const isDestructuring = (node: Node): boolean => Node.isArrayLiteralExpression(node) || Node.isObjectLiteralExpression(node);

const targetsOf = (binary: BinaryExpression): readonly Node[] => {
  const left = unwrap(binary.getLeft());
  return isDestructuring(left) ? left.getDescendants().filter(isMemberAccess) : [left];
};

const assignmentsIn = (classes: readonly ClassLike[]): readonly Assignment[] =>
  classes
    .flatMap((cls) => cls.getDescendantsOfKind(SyntaxKind.BinaryExpression))
    .filter(isAssignment)
    .flatMap((binary) => targetsOf(binary).map((target) => ({ binary, target })));

const loopTargets = (classes: readonly ClassLike[]): readonly Node[] =>
  classes
    .flatMap((cls) => [...cls.getDescendantsOfKind(SyntaxKind.ForOfStatement), ...cls.getDescendantsOfKind(SyntaxKind.ForInStatement)])
    .map((loop) => unwrap(loop.getInitializer()))
    .flatMap((initializer) => (isDestructuring(initializer) ? initializer.getDescendants().filter(isMemberAccess) : [initializer]));

const deletedTargets = (classes: readonly ClassLike[]): readonly Node[] =>
  classes.flatMap((cls) => cls.getDescendantsOfKind(SyntaxKind.DeleteExpression)).map((deletion) => unwrap(deletion.getExpression()));

const isScopeBoundary = (node: Node): boolean =>
  Node.isFunctionLikeDeclaration(node) ||
  Node.isFunctionExpression(node) ||
  Node.isClassStaticBlockDeclaration(node) ||
  Node.isPropertyDeclaration(node);

const certainWriters = (cls: ClassDeclaration, methods: ReadonlySet<Node>): ReadonlySet<Node> =>
  new Set<Node>([...methods, ...projectAncestry(cls).flatMap((candidate) => candidate.getConstructors())]);

const isCertain = ({ binary, target }: Assignment, writers: ReadonlySet<Node>): boolean => {
  const scope = target.getFirstAncestor(isScopeBoundary);
  return (
    binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    unwrap(binary.getLeft()) === target &&
    fieldNameOf(target) !== undefined &&
    scope !== undefined &&
    writers.has(scope)
  );
};

const uncertainlyAssigned = (assignments: readonly Assignment[], writers: ReadonlySet<Node>): ReadonlySet<string> =>
  new Set(
    assignments
      .filter((assignment) => isMemberAccess(assignment.target) && !isCertain(assignment, writers))
      .flatMap(({ target }) => memberName(target) ?? []),
  );

const isObjectAssignTarget = (node: Node): boolean => {
  const call = node.getParent();
  return Node.isCallExpression(call) && call.getExpression().getText() === 'Object.assign' && call.getArguments()[0] === node;
};

const isModelledEscape = (node: Node, methods: ReadonlySet<Node>): boolean => {
  const scope = node.getFirstAncestor(isScopeBoundary);
  return scope !== undefined && (methods.has(scope) || (Node.isConstructorDeclaration(scope) && isObjectAssignTarget(node)));
};

const EQUALITY_OPERATORS: readonly SyntaxKind[] = [
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
];

const isComparedOnly = (node: Node): boolean => {
  const comparison = node.getParent();
  return Node.isBinaryExpression(comparison) && EQUALITY_OPERATORS.includes(comparison.getOperatorToken().getKind());
};

const escapesOutsideMethods = (classes: readonly ClassLike[], methods: ReadonlySet<Node>): boolean =>
  classes
    .flatMap((candidate) => candidate.getDescendants())
    .some(
      (node) =>
        escapesStateHolder(node) && !isAssignmentTarget(node) && !isComparedOnly(node) && !isModelledEscape(node, methods),
    );

const namesAnyOf = (heritage: Node, names: ReadonlySet<string>): boolean =>
  [heritage, ...heritage.getDescendants()].some((node) => Node.isIdentifier(node) && names.has(node.getText()));

const extendsFamily = (expression: ClassExpression, cls: ClassDeclaration, names: ReadonlySet<string>): boolean => {
  const heritage = expression.getExtends();
  if (heritage === undefined) return false;
  const base = expression.getBaseClass();
  return base === undefined ? namesAnyOf(heritage, names) : projectAncestry(base).includes(cls);
};

const subclassExpressions = (
  sources: SourceIndex,
  cls: ClassDeclaration,
  subclasses: readonly ClassDeclaration[],
): readonly ClassExpression[] => {
  const names = new Set([cls, ...subclasses].flatMap((candidate) => candidate.getName() ?? []));
  return sources.ofKind(SyntaxKind.ClassExpression).filter((expression) => extendsFamily(expression, cls, names));
};

const methodImplementations = (scope: AggregateScope, aggregateBaseClasses: readonly string[]): ReadonlySet<Node> =>
  new Set(instanceMethods(scope.cls, aggregateBaseClasses, scope.arrowMethods).map((method) => method.implementation));

const uncertainInClass = (
  scope: AggregateScope,
  aggregateBaseClasses: readonly string[],
  sources: SourceIndex,
): ((field: StateField) => boolean) => {
  const { cls } = scope;
  const subclasses = cls.getDerivedClasses();
  const classes = [...projectAncestry(cls), ...subclasses, ...subclassExpressions(sources, cls, subclasses)];
  const methods = methodImplementations(scope, aggregateBaseClasses);
  if (escapesOutsideMethods(classes, methods)) return () => true;
  const assignments = assignmentsIn(classes);
  const otherTargets = [...loopTargets(classes), ...deletedTargets(classes)].filter(isMemberAccess);
  const targets = [...assignments.map(({ target }) => target), ...otherTargets];
  if (targets.some(isComputedStateAccess)) return () => true;
  const names = new Set([
    ...uncertainlyAssigned(assignments, certainWriters(cls, methods)),
    ...otherTargets.flatMap((target) => memberName(target) ?? []),
  ]);
  return (field) => names.has(field.name);
};

export const fieldsWrittenUncertainly = (
  scope: AggregateScope,
  aggregateBaseClasses: readonly string[],
  sources: SourceIndex,
  fields: readonly StateField[],
  root: string,
): ReadonlySet<string> => {
  const { cls } = scope;
  const accessors = instanceAccessors(cls, aggregateBaseClasses);
  const assignedUncertainly = uncertainInClass(scope, aggregateBaseClasses, sources);
  return new Set(
    fields
      .filter(
        (field) =>
          assignedUncertainly(field) || writtenByAny(accessors, field) || writtenOutsideClass(sources, cls, field, root),
      )
      .map((field) => field.name),
  );
};
