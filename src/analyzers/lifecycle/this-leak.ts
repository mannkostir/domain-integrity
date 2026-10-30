import {
  BinaryExpression,
  ClassDeclaration,
  Identifier,
  Node,
  Symbol as MorphSymbol,
  SyntaxKind,
  Type,
} from 'ts-morph';
import { ArrowMethods } from './arrow-methods';
import {
  escapesStateHolder,
  hasForeignThis,
  inheritanceChain,
  isReceiverOfAccess,
} from './field-ref';
import { isLibraryNode } from '../shared/library';
import { outermostWrapper, unwrap } from '../shared/wrappers';
import { Subclasses } from './subclasses';

const NON_RETAINING_CALLBACKS = new Set([
  'filter',
  'map',
  'some',
  'every',
  'find',
  'findIndex',
  'forEach',
  'reduce',
  'flatMap',
  'sort',
]);

const FAMILY_ASSIGNMENT_OPERATORS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
]);

const isAssignmentTarget = (node: Node): boolean => {
  const parent = node.getParent();
  return (
    Node.isBinaryExpression(parent) &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    parent.getLeft() === node
  );
};

const isObjectAssign = (callee: Node): boolean =>
  Node.isPropertyAccessExpression(callee) &&
  callee.getName() === 'assign' &&
  Node.isIdentifier(callee.getExpression()) &&
  callee.getExpression().getText() === 'Object';

const isCopiedInto = (node: Node): boolean => {
  const target = outermostWrapper(node);
  const call = target.getParent();
  return (
    Node.isCallExpression(call) &&
    call.getArguments()[0] === target &&
    isObjectAssign(unwrap(call.getExpression())) &&
    Node.isExpressionStatement(outermostWrapper(call).getParent())
  );
};

type Family = {
  readonly classes: ReadonlySet<Node>;
  readonly arrowMethods: ReadonlySet<Node>;
  readonly arrowMethodsCaptureThis: boolean;
};

const isPropsHolder = (node: Node): boolean => {
  const target = unwrap(node);
  return Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target);
};

const isCopiedOutOf = (node: Node, family: Family): boolean =>
  Node.isSpreadAssignment(outermostWrapper(node).getParent()) && (!family.arrowMethodsCaptureThis || isPropsHolder(node));

const escapesAggregate = (node: Node, family: Family): boolean =>
  escapesStateHolder(node) &&
  !hasForeignThis(node) &&
  !isAssignmentTarget(node) &&
  !isCopiedInto(node) &&
  !isCopiedOutOf(node, family);

const isBuiltInArray = (type: Type): boolean => {
  const target = type.getNonNullableType();
  return target.isArray() || target.isReadonlyArray() || target.isTuple();
};

const isNonRetainingCallback = (closure: Node): boolean => {
  const call = closure.getParent();
  if (!Node.isCallExpression(call) || !call.getArguments().includes(closure)) return false;
  const callee = call.getExpression();
  return (
    Node.isPropertyAccessExpression(callee) &&
    NON_RETAINING_CALLBACKS.has(callee.getName()) &&
    isBuiltInArray(callee.getExpression().getType())
  );
};

const capturesThis = (node: Node): boolean =>
  [...node.getDescendantsOfKind(SyntaxKind.ThisKeyword), ...node.getDescendantsOfKind(SyntaxKind.SuperKeyword)].some(
    (self) => !hasForeignThis(self),
  );

const capturesAggregate = (node: Node, family: Family): boolean =>
  Node.isArrowFunction(node) && !family.arrowMethods.has(node) && !isNonRetainingCallback(node) && capturesThis(node);

const isStaticMember = (member: Node): boolean =>
  Node.isClassStaticBlockDeclaration(member) ||
  ((Node.isMethodDeclaration(member) ||
    Node.isPropertyDeclaration(member) ||
    Node.isGetAccessorDeclaration(member) ||
    Node.isSetAccessorDeclaration(member)) &&
    member.isStatic());

const refersToFamily = (type: Type, family: ReadonlySet<Node>): boolean =>
  [type, ...type.getUnionTypes()].some((member) =>
    (member.getSymbol()?.getDeclarations() ?? []).some((declaration) => family.has(declaration)),
  );

const isFamilyConstruction = (node: Node | undefined, family: ReadonlySet<Node>): boolean => {
  const target = node === undefined ? undefined : unwrap(node);
  return Node.isNewExpression(target) && refersToFamily(target.getType(), family);
};

const constructsFamily = (member: Node, family: ReadonlySet<Node>): boolean =>
  member.getDescendantsOfKind(SyntaxKind.NewExpression).some((expression) => isFamilyConstruction(expression, family));

const isFactoryMember = (member: Node, family: ReadonlySet<Node>): boolean =>
  isStaticMember(member) || constructsFamily(member, family);

const symbolsOf = (nodes: readonly Node[]): readonly MorphSymbol[] =>
  nodes.flatMap((node) => {
    const symbol = node.getSymbol();
    return symbol === undefined ? [] : [symbol];
  });

const declaredInstances = (member: Node, family: ReadonlySet<Node>): readonly MorphSymbol[] =>
  symbolsOf(
    [...member.getDescendantsOfKind(SyntaxKind.VariableDeclaration), ...member.getDescendantsOfKind(SyntaxKind.Parameter)].filter(
      (declaration) =>
        refersToFamily(declaration.getType(), family) || isFamilyConstruction(declaration.getInitializer(), family),
    ),
  );

const isFamilyAssignment = (expression: BinaryExpression, family: ReadonlySet<Node>): boolean =>
  FAMILY_ASSIGNMENT_OPERATORS.has(expression.getOperatorToken().getKind()) &&
  isFamilyConstruction(expression.getRight(), family);

const assignedInstances = (member: Node, family: ReadonlySet<Node>): readonly MorphSymbol[] =>
  symbolsOf(
    member
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((expression) => isFamilyAssignment(expression, family))
      .map((expression) => unwrap(expression.getLeft()))
      .filter(Node.isIdentifier),
  );

const instanceReferences = (member: Node, family: ReadonlySet<Node>): readonly Identifier[] => {
  const symbols = new Set([...declaredInstances(member, family), ...assignedInstances(member, family)]);
  return member
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((identifier) => {
      const symbol = identifier.getSymbol();
      const parent = identifier.getParent();
      const declares = (Node.isVariableDeclaration(parent) || Node.isParameterDeclaration(parent)) && parent.getNameNode() === identifier;
      return symbol !== undefined && symbols.has(symbol) && !declares;
    });
};

const holderOf = (reference: Node): Node => {
  const target = outermostWrapper(reference);
  const parent = target.getParent();
  return Node.isPropertyAccessExpression(parent) && parent.getExpression() === target && parent.getName() === 'props'
    ? outermostWrapper(parent)
    : target;
};

const isReturnedAsIs = (node: Node): boolean => Node.isReturnStatement(node.getParent());

const instanceEscapes = (reference: Node, family: Family): boolean => {
  const holder = holderOf(reference);
  return (
    !isReceiverOfAccess(holder) &&
    !isAssignmentTarget(holder) &&
    !isCopiedInto(holder) &&
    !isCopiedOutOf(holder, family) &&
    !isReturnedAsIs(holder)
  );
};

const isClosure = (node: Node): boolean =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  (Node.isMethodDeclaration(node) && Node.isObjectLiteralExpression(node.getParent()));

const capturedInClosure = (reference: Node, member: Node, family: Family): boolean => {
  const ancestors = reference.getAncestors();
  return ancestors
    .slice(0, ancestors.indexOf(member))
    .some((ancestor) => isClosure(ancestor) && !family.arrowMethods.has(ancestor) && !isNonRetainingCallback(ancestor));
};

const factoryMembersLeak = (cls: ClassDeclaration, family: Family): boolean =>
  cls
    .getMembers()
    .filter((member) => isFactoryMember(member, family.classes))
    .some((member) =>
      instanceReferences(member, family.classes).some(
        (reference) => instanceEscapes(reference, family) || capturedInClosure(reference, member, family),
      ),
    );

const leaksFrom = (cls: ClassDeclaration, family: Family): boolean =>
  cls.getDescendants().some((node) => escapesAggregate(node, family) || capturesAggregate(node, family)) ||
  factoryMembersLeak(cls, family);

export const classFamily = (cls: ClassDeclaration, subclasses: Subclasses): readonly ClassDeclaration[] => [
  ...inheritanceChain(cls).filter((candidate) => !isLibraryNode(candidate)),
  ...subclasses.of(cls),
];

export const leaksThis = (family: readonly ClassDeclaration[], arrows: ArrowMethods): boolean => {
  const context: Family = {
    classes: new Set<Node>(family),
    arrowMethods: new Set<Node>(arrows.values()),
    arrowMethodsCaptureThis: [...arrows.values()].some(capturesThis),
  };
  return family.some((candidate) => leaksFrom(candidate, context));
};
