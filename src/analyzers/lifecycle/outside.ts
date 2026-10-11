import { BinaryExpression, CallExpression, ClassDeclaration, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { assignedValue, isAssignmentOperator } from './assigned';
import { inheritanceChain } from './field-ref';
import { isLibraryNode } from '../shared/library';
import { SourceIndex } from '../shared/source-index';
import { OutsideAssignment, StateField } from './model';
import { UNRESOLVED } from './values';
import { unwrap } from '../shared/wrappers';

const isInstanceOf = (type: Type, cls: ClassDeclaration): boolean =>
  type.getNonNullableType().getSymbol()?.getDeclarations().includes(cls) ?? false;

const hasAggregateType = (node: Node, cls: ClassDeclaration): boolean =>
  isInstanceOf(node.getType(), cls) || isInstanceOf(unwrap(node).getType(), cls);

const isAggregateOrItsProps = (node: Node, cls: ClassDeclaration): boolean => {
  const target = unwrap(node);
  const isProps = Node.isPropertyAccessExpression(target) && target.getName() === 'props';
  return hasAggregateType(node, cls) || (isProps && hasAggregateType(target.getExpression(), cls));
};

const targetsField = (left: Node, cls: ClassDeclaration, field: string): boolean =>
  Node.isPropertyAccessExpression(left) && left.getName() === field && isAggregateOrItsProps(left.getExpression(), cls);

const isOwnSetter = (node: Node, cls: ClassDeclaration): boolean =>
  Node.isSetAccessorDeclaration(node) &&
  inheritanceChain(cls)
    .filter((candidate) => !isLibraryNode(candidate))
    .some((candidate) => candidate === node.getParent());

const hasOwnSetter = (cls: ClassDeclaration, field: string): boolean =>
  cls
    .getType()
    .getProperty(field)
    ?.getDeclarations()
    .some((declaration) => isOwnSetter(declaration, cls)) ?? false;

const writesThroughOwnSetter = (receiver: Node | undefined, cls: ClassDeclaration, field: string): boolean =>
  receiver !== undefined && hasAggregateType(receiver, cls) && hasOwnSetter(cls, field);

const receiverOf = (left: Node): Node => (Node.isPropertyAccessExpression(left) ? left.getExpression() : left);

const carriesField = (type: Type, field: string): boolean =>
  type.getProperty(field) !== undefined ||
  type.getStringIndexType() !== undefined ||
  (type.isUnion() && type.getUnionTypes().some((member) => carriesField(member, field)));

const isObjectAssign = (call: CallExpression): boolean => {
  const callee = call.getExpression();
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === 'assign' &&
    callee.getExpression().getText() === 'Object'
  );
};

const objectAssignTargetsField = (call: CallExpression, cls: ClassDeclaration, field: string): boolean => {
  const [target, ...sources] = call.getArguments();
  return (
    isObjectAssign(call) &&
    target !== undefined &&
    isAggregateOrItsProps(target, cls) &&
    sources.some((source) => carriesField(source.getType(), field))
  );
};

const nameOf = (node: Node): string | undefined => {
  if (Node.isMethodDeclaration(node) || Node.isVariableDeclaration(node)) return node.getName();
  if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) return node.getName() ?? '<anonymous>';
  return undefined;
};

const enclosingName = (node: Node): string =>
  node
    .getAncestors()
    .map(nameOf)
    .filter((name): name is string => name !== undefined)
    .reverse()
    .join('.') || '<module>';

const isOutside = (node: Node, cls: ClassDeclaration): boolean =>
  node.getFirstAncestor((ancestor) => ancestor === cls) === undefined;

const located = (node: Node, field: StateField) => ({
  field: field.name,
  file: node.getSourceFile().getFilePath(),
  line: node.getStartLineNumber(),
  scope: enclosingName(node),
});

const assignmentsTo = (sources: SourceIndex, field: string): readonly BinaryExpression[] =>
  sources.propertyAccessesNamed(field).flatMap((access) => {
    const parent = access.getParent();
    return Node.isBinaryExpression(parent) && parent.getLeft() === access ? [parent] : [];
  });

const objectAssignCalls = (sources: SourceIndex): readonly CallExpression[] =>
  sources.propertyAccessesNamed('assign').flatMap((access) => {
    const call = access.getParent();
    return Node.isCallExpression(call) && call.getExpression() === access && isObjectAssign(call) ? [call] : [];
  });

type SourcedAssignment = { readonly source: SourceFile; readonly assignment: OutsideAssignment };

const sourced = (node: Node, assignment: OutsideAssignment): SourcedAssignment => ({
  source: node.getSourceFile(),
  assignment,
});

const directAssignments = (sources: SourceIndex, cls: ClassDeclaration, field: StateField): SourcedAssignment[] =>
  assignmentsTo(sources, field.name)
    .filter(isAssignmentOperator)
    .filter((binary) => isOutside(binary, cls))
    .filter((binary) => targetsField(binary.getLeft(), cls, field.name))
    .map((binary) =>
      sourced(binary, {
        ...located(binary, field),
        value:
          binary.getOperatorToken().getKind() === SyntaxKind.EqualsToken
            ? assignedValue(binary.getRight(), field)
            : UNRESOLVED,
        throughOwnSetter: writesThroughOwnSetter(receiverOf(binary.getLeft()), cls, field.name),
      }),
    );

const objectAssignments = (sources: SourceIndex, cls: ClassDeclaration, field: StateField): SourcedAssignment[] =>
  objectAssignCalls(sources)
    .filter((call) => isOutside(call, cls))
    .filter((call) => objectAssignTargetsField(call, cls, field.name))
    .map((call) =>
      sourced(call, {
        ...located(call, field),
        value: UNRESOLVED,
        throughOwnSetter: writesThroughOwnSetter(call.getArguments()[0], cls, field.name),
      }),
    );

const inFileOrder = (files: readonly SourceFile[], entries: readonly SourcedAssignment[]): OutsideAssignment[] =>
  files.flatMap((file) => entries.filter(({ source }) => source === file).map(({ assignment }) => assignment));

export const outsideAssignments = (sources: SourceIndex, cls: ClassDeclaration, field: StateField): OutsideAssignment[] =>
  inFileOrder(sources.files, [...directAssignments(sources, cls, field), ...objectAssignments(sources, cls, field)]).sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
