import { BinaryExpression, ClassDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { isAssignmentTarget, setsOf } from './assigned';
import { escapesStateHolder, fieldNameOf, isComputedStateAccess, memberName } from './field-ref';
import { instanceAccessors, instanceMethods, projectAncestry } from './members';
import { AssignedValues, StateField } from './model';
import { outsideAssignments } from './outside';
import { hasUnknownWrite } from './values';
import { unwrap } from '../shared/wrappers';

type Assignment = { readonly binary: BinaryExpression; readonly target: Node };

const mayChange = (value: AssignedValues): boolean => value.tokens.size > 0 || hasUnknownWrite(value);

const writtenByAny = (accessors: readonly Node[], field: StateField): boolean =>
  accessors.some((accessor) => mayChange(setsOf(accessor, field)));

const writtenOutsideClass = (files: readonly SourceFile[], cls: ClassDeclaration, field: StateField): boolean =>
  outsideAssignments(files, cls, field).length > 0;

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

const assignmentsIn = (classes: readonly ClassDeclaration[]): readonly Assignment[] =>
  classes
    .flatMap((cls) => cls.getDescendantsOfKind(SyntaxKind.BinaryExpression))
    .filter(isAssignment)
    .flatMap((binary) => targetsOf(binary).map((target) => ({ binary, target })));

const loopTargets = (classes: readonly ClassDeclaration[]): readonly Node[] =>
  classes
    .flatMap((cls) => [...cls.getDescendantsOfKind(SyntaxKind.ForOfStatement), ...cls.getDescendantsOfKind(SyntaxKind.ForInStatement)])
    .map((loop) => unwrap(loop.getInitializer()))
    .flatMap((initializer) => (isDestructuring(initializer) ? initializer.getDescendants().filter(isMemberAccess) : [initializer]));

const deletedTargets = (classes: readonly ClassDeclaration[]): readonly Node[] =>
  classes.flatMap((cls) => cls.getDescendantsOfKind(SyntaxKind.DeleteExpression)).map((deletion) => unwrap(deletion.getExpression()));

const isScopeBoundary = (node: Node): boolean =>
  Node.isFunctionLikeDeclaration(node) ||
  Node.isFunctionExpression(node) ||
  Node.isClassStaticBlockDeclaration(node) ||
  Node.isPropertyDeclaration(node);

const certainWriters = (cls: ClassDeclaration, aggregateBaseClasses: readonly string[]): ReadonlySet<Node> =>
  new Set<Node>([
    ...instanceMethods(cls, aggregateBaseClasses),
    ...projectAncestry(cls).flatMap((candidate) => candidate.getConstructors()),
  ]);

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

const escapesOutsideMethods = (classes: readonly ClassDeclaration[], methods: ReadonlySet<Node>): boolean =>
  classes
    .flatMap((candidate) => candidate.getDescendants())
    .some((node) => escapesStateHolder(node) && !isAssignmentTarget(node) && !isModelledEscape(node, methods));

const uncertainInClass = (cls: ClassDeclaration, aggregateBaseClasses: readonly string[]): ((field: StateField) => boolean) => {
  const classes = [...projectAncestry(cls), ...cls.getDerivedClasses()];
  if (escapesOutsideMethods(classes, new Set(instanceMethods(cls, aggregateBaseClasses)))) return () => true;
  const assignments = assignmentsIn(classes);
  const otherTargets = [...loopTargets(classes), ...deletedTargets(classes)].filter(isMemberAccess);
  const targets = [...assignments.map(({ target }) => target), ...otherTargets];
  if (targets.some(isComputedStateAccess)) return () => true;
  const names = new Set([
    ...uncertainlyAssigned(assignments, certainWriters(cls, aggregateBaseClasses)),
    ...otherTargets.flatMap((target) => memberName(target) ?? []),
  ]);
  return (field) => names.has(field.name);
};

export const fieldsWrittenUncertainly = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
  files: readonly SourceFile[],
  fields: readonly StateField[],
): ReadonlySet<string> => {
  const accessors = instanceAccessors(cls, aggregateBaseClasses);
  const assignedUncertainly = uncertainInClass(cls, aggregateBaseClasses);
  return new Set(
    fields
      .filter(
        (field) =>
          assignedUncertainly(field) || writtenByAny(accessors, field) || writtenOutsideClass(files, cls, field),
      )
      .map((field) => field.name),
  );
};
