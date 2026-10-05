import { ClassDeclaration, Node, PropertyDeclaration, SyntaxKind } from 'ts-morph';
import { isLibraryNode } from './library';
import { outermostWrapper, unwrap } from './wrappers';

const isEmptyArrayLiteral = (node: Node | undefined): boolean => {
  const target = node === undefined ? undefined : unwrap(node);
  return Node.isArrayLiteralExpression(target) && target.getElements().length === 0;
};

const isPrivateField = (property: PropertyDeclaration): boolean =>
  property.hasModifier(SyntaxKind.PrivateKeyword) || Node.isPrivateIdentifier(property.getNameNode());

const isPlainDeclaration = (property: PropertyDeclaration): boolean => {
  const initializer = property.getInitializer();
  return (
    !isLibraryNode(property) &&
    !property.isStatic() &&
    isPrivateField(property) &&
    !property.hasModifier(SyntaxKind.DeclareKeyword) &&
    !property.hasModifier(SyntaxKind.AccessorKeyword) &&
    property.getDecorators().length === 0 &&
    (initializer === undefined || isEmptyArrayLiteral(initializer))
  );
};

const isAssignmentOperator = (kind: SyntaxKind): boolean =>
  kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment;

const isDestructuringPart = (node: Node): boolean =>
  Node.isArrayLiteralExpression(node) ||
  Node.isObjectLiteralExpression(node) ||
  Node.isPropertyAssignment(node) ||
  Node.isShorthandPropertyAssignment(node) ||
  Node.isSpreadElement(node) ||
  Node.isSpreadAssignment(node) ||
  Node.isParenthesizedExpression(node);

const destructuringRoot = (node: Node): Node => {
  const parent = node.getParent();
  return parent !== undefined && isDestructuringPart(parent) ? destructuringRoot(parent) : node;
};

const UPDATE_OPERATORS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

const isUpdated = (parent: Node | undefined): boolean =>
  (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
  UPDATE_OPERATORS.has(parent.getOperatorToken());

const isWritten = (target: Node): boolean => {
  const root = destructuringRoot(target);
  const parent = root.getParent();
  if (Node.isBinaryExpression(parent)) {
    return parent.getLeft() === root && isAssignmentOperator(parent.getOperatorToken().getKind());
  }
  if (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) return parent.getInitializer() === root;
  return isUpdated(parent) || Node.isDeleteExpression(parent);
};

const isResetToEmpty = (target: Node): boolean => {
  const parent = target.getParent();
  return (
    Node.isBinaryExpression(parent) &&
    parent.getLeft() === target &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    isEmptyArrayLiteral(parent.getRight())
  );
};

const accessOf = (reference: Node): Node | undefined => {
  const parent = reference.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference) return parent;
  if (Node.isElementAccessExpression(parent) && parent.getArgumentExpression() === reference) return parent;
  return undefined;
};

const isSafeReference = (reference: Node): boolean => {
  const access = accessOf(reference);
  if (access === undefined) return false;
  const target = outermostWrapper(access);
  return isResetToEmpty(target) || !isWritten(target);
};

const isObjectAssignOntoThis = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const callee = unwrap(node.getExpression());
  const [target] = node.getArguments();
  return (
    Node.isPropertyAccessExpression(callee) &&
    callee.getName() === 'assign' &&
    unwrap(callee.getExpression()).getText() === 'Object' &&
    target !== undefined &&
    Node.isThisExpression(unwrap(target))
  );
};

const assignsOntoThis = (cls: ClassDeclaration): boolean =>
  cls.getDescendantsOfKind(SyntaxKind.CallExpression).some(isObjectAssignOntoThis);

export const isPlainEventArray = (property: PropertyDeclaration, family: readonly ClassDeclaration[]): boolean =>
  isPlainDeclaration(property) &&
  !family.some(assignsOntoThis) &&
  property
    .findReferencesAsNodes()
    .filter((reference) => reference !== property.getNameNode())
    .every(isSafeReference);

export const plainEventArrays = (family: readonly ClassDeclaration[]): ReadonlySet<Node> =>
  new Set(family.flatMap((cls) => cls.getProperties()).filter((property) => isPlainEventArray(property, family)));
