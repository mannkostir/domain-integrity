import { ClassDeclaration, Identifier, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import {
  escapesStateHolder,
  hasForeignThis,
  inheritanceChain,
  isReceiverOfAccess,
  outermostWrapper,
  unwrap,
} from './field-ref';
import { isLibraryNode } from './library';

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

const isCopiedOutOf = (node: Node): boolean => Node.isSpreadAssignment(outermostWrapper(node).getParent());

const escapesAggregate = (node: Node): boolean =>
  escapesStateHolder(node) &&
  !hasForeignThis(node) &&
  !isAssignmentTarget(node) &&
  !isCopiedInto(node) &&
  !isCopiedOutOf(node);

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

const capturesAggregate = (node: Node): boolean =>
  Node.isArrowFunction(node) &&
  !isNonRetainingCallback(node) &&
  node.getDescendantsOfKind(SyntaxKind.ThisKeyword).some((self) => !hasForeignThis(self));

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

const instanceReferences = (member: Node, family: ReadonlySet<Node>): readonly Identifier[] => {
  const symbols = new Set(
    [...member.getDescendantsOfKind(SyntaxKind.VariableDeclaration), ...member.getDescendantsOfKind(SyntaxKind.Parameter)]
      .filter((declaration) => refersToFamily(declaration.getType(), family))
      .flatMap((declaration) => {
        const symbol = declaration.getSymbol();
        return symbol === undefined ? [] : [symbol];
      }),
  );
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

const instanceEscapes = (reference: Node): boolean => {
  const holder = holderOf(reference);
  return (
    !isReceiverOfAccess(holder) &&
    !isAssignmentTarget(holder) &&
    !isCopiedInto(holder) &&
    !isCopiedOutOf(holder) &&
    !isReturnedAsIs(holder)
  );
};

const isClosure = (node: Node): boolean =>
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isFunctionDeclaration(node) ||
  (Node.isMethodDeclaration(node) && Node.isObjectLiteralExpression(node.getParent()));

const capturedInClosure = (reference: Node, member: Node): boolean => {
  const ancestors = reference.getAncestors();
  return ancestors
    .slice(0, ancestors.indexOf(member))
    .some((ancestor) => isClosure(ancestor) && !isNonRetainingCallback(ancestor));
};

const staticMembersLeak = (cls: ClassDeclaration, family: ReadonlySet<Node>): boolean =>
  cls
    .getMembers()
    .filter(isStaticMember)
    .some((member) =>
      instanceReferences(member, family).some(
        (reference) => instanceEscapes(reference) || capturedInClosure(reference, member),
      ),
    );

const leaksFrom = (cls: ClassDeclaration, family: ReadonlySet<Node>): boolean =>
  cls.getDescendants().some((node) => escapesAggregate(node) || capturesAggregate(node)) ||
  staticMembersLeak(cls, family);

const projectSubclasses = (cls: ClassDeclaration, files: readonly SourceFile[]): readonly ClassDeclaration[] =>
  files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .filter((candidate) => candidate !== cls && inheritanceChain(candidate).includes(cls));

const classFamily = (cls: ClassDeclaration, files: readonly SourceFile[]): readonly ClassDeclaration[] => [
  ...inheritanceChain(cls).filter((candidate) => !isLibraryNode(candidate)),
  ...projectSubclasses(cls, files),
];

export const leaksThis = (cls: ClassDeclaration, files: readonly SourceFile[]): boolean => {
  const family = classFamily(cls, files);
  const members = new Set<Node>(family);
  return family.some((candidate) => leaksFrom(candidate, members));
};
