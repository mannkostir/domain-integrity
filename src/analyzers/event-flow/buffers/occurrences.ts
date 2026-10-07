import { ClassDeclaration, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { destructuringRoot } from '../../shared/writes';
import { unwrap } from '../../shared/wrappers';
import { isPrivateMember } from './private-member';

const OCCURRENCE_KINDS = [
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
] as const;

const isOccurrenceKind = (node: Node): boolean => OCCURRENCE_KINDS.some((kind) => node.getKind() === kind);

const textOf = (node: Node): string =>
  Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : node.getText();

const isBindingPattern = (node: Node): boolean => Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node);

const isAssignedTo = (root: Node, parent: Node | undefined): boolean =>
  Node.isBinaryExpression(parent) &&
  parent.getLeft() === root &&
  parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken;

const isLoopHeadTarget = (root: Node, parent: Node | undefined): boolean =>
  (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) && parent.getInitializer() === root;

const isDestructuringAssignmentTarget = (node: Node): boolean => {
  const root = destructuringRoot(node);
  const parent = root.getParent();
  return root !== node && (isAssignedTo(root, parent) || isLoopHeadTarget(root, parent));
};

const isInDestructuring = (node: Node): boolean =>
  node.getFirstAncestor(isBindingPattern) !== undefined || isDestructuringAssignmentTarget(node);

const isNamedDeclaration = (node: Node): node is Node & { getNameNode(): Node } =>
  Node.isVariableDeclaration(node) ||
  Node.isParameterDeclaration(node) ||
  Node.isFunctionDeclaration(node) ||
  Node.isFunctionExpression(node) ||
  Node.isClassDeclaration(node) ||
  Node.isClassExpression(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isMethodSignature(node) ||
  Node.isGetAccessorDeclaration(node) ||
  Node.isSetAccessorDeclaration(node) ||
  Node.isPropertyDeclaration(node) ||
  Node.isPropertySignature(node) ||
  Node.isPropertyAssignment(node) ||
  Node.isShorthandPropertyAssignment(node) ||
  Node.isEnumMember(node) ||
  Node.isImportSpecifier(node) ||
  Node.isExportSpecifier(node);

const isSpecifierAlias = (node: Node, parent: Node): boolean =>
  (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent)) && parent.getAliasNode() === node;

const isDeclarationName = (node: Node): boolean => {
  const parent = node.getParent();
  return parent !== undefined && ((isNamedDeclaration(parent) && parent.getNameNode() === node) || isSpecifierAlias(node, parent));
};

const isPropertyAccessName = (node: Node): boolean => {
  const parent = node.getParent();
  return Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node;
};

const resolvesOnlyElsewhere = (node: Node, target: Node): boolean => {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && !declarations.includes(target);
};

const isOtherReference = (node: Node, target: Node): boolean =>
  Node.isIdentifier(node) && !isPropertyAccessName(node) && !isDeclarationName(node) && resolvesOnlyElsewhere(node, target);

const isPrimitive = (type: Type): boolean =>
  type.isString() ||
  type.isNumber() ||
  type.isBoolean() ||
  type.isBigInt() ||
  type.isStringLiteral() ||
  type.isNumberLiteral() ||
  type.isBooleanLiteral();

const typeDeclarationsOf = (type: Type): readonly Node[] => type.getSymbol()?.getDeclarations() ?? [];

const isNonFamilyClassType = (type: Type, family: readonly ClassDeclaration[]): boolean => {
  const declarations = typeDeclarationsOf(type);
  return (
    !type.isAnonymous() &&
    declarations.length > 0 &&
    declarations.every((declaration) => Node.isClassDeclaration(declaration) && !family.includes(declaration))
  );
};

const isNonFamilyClassOrUnion = (type: Type, family: readonly ClassDeclaration[]): boolean =>
  type.isUnion()
    ? type.getUnionTypes().every((member) => isNonFamilyClassType(member, family))
    : isNonFamilyClassType(type, family);

const isProvablyOtherReceiver = (type: Type, family: readonly ClassDeclaration[]): boolean =>
  isPrimitive(type) || isNonFamilyClassOrUnion(type, family);

const isOtherClassAccess = (node: Node, target: Node, family: readonly ClassDeclaration[]): boolean => {
  const parent = node.getParent();
  return (
    isPrivateMember(target) &&
    Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === node &&
    isProvablyOtherReceiver(unwrap(parent.getExpression()).getType(), family)
  );
};

const isProvablyOther = (node: Node, target: Node, family: readonly ClassDeclaration[]): boolean =>
  !isInDestructuring(node) && (isDeclarationName(node) || isOtherReference(node, target) || isOtherClassAccess(node, target, family));

const readableNameNode = (target: Node): Node | undefined => {
  const nameNode = Node.hasName(target) ? target.getNameNode() : undefined;
  return nameNode !== undefined && isOccurrenceKind(nameNode) ? nameNode : undefined;
};

type NameIndex = ReadonlyMap<string, readonly Node[]>;

const buildNameIndex = (files: readonly SourceFile[]): NameIndex => {
  const index = new Map<string, Node[]>();
  files
    .flatMap((file) => OCCURRENCE_KINDS.flatMap((kind) => file.getDescendantsOfKind(kind)))
    .forEach((node) => {
      const name = textOf(node);
      const named = index.get(name);
      if (named === undefined) index.set(name, [node]);
      else named.push(node);
    });
  return index;
};

const nameIndexes = new WeakMap<readonly SourceFile[], NameIndex>();

const nameIndexOf = (files: readonly SourceFile[]): NameIndex => {
  const known = nameIndexes.get(files);
  if (known !== undefined) return known;
  const index = buildNameIndex(files);
  nameIndexes.set(files, index);
  return index;
};

export const occurrencesOf = (
  target: Node,
  files: readonly SourceFile[],
  family: readonly ClassDeclaration[],
): readonly Node[] | undefined => {
  const nameNode = readableNameNode(target);
  if (nameNode === undefined) return undefined;
  return (nameIndexOf(files).get(textOf(nameNode)) ?? [])
    .filter((node) => node !== nameNode)
    .filter((node) => !isProvablyOther(node, target, family));
};
