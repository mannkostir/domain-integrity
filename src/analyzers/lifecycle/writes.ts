import { ClassDeclaration, ElementAccessExpression, Node, SourceFile, SyntaxKind, Type } from 'ts-morph';
import { outermostWrapper, unwrap } from './wrappers';

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

export const destructuringRoot = (node: Node): Node => {
  const parent = node.getParent();
  return parent !== undefined && isDestructuringPart(parent) ? destructuringRoot(parent) : node;
};

const UPDATE_OPERATORS: ReadonlySet<SyntaxKind> = new Set([SyntaxKind.PlusPlusToken, SyntaxKind.MinusMinusToken]);

const isUpdated = (parent: Node | undefined): boolean =>
  (Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)) &&
  UPDATE_OPERATORS.has(parent.getOperatorToken());

export const isWritten = (target: Node): boolean => {
  const root = destructuringRoot(target);
  const parent = root.getParent();
  if (Node.isBinaryExpression(parent)) {
    return parent.getLeft() === root && isAssignmentOperator(parent.getOperatorToken().getKind());
  }
  if (Node.isForOfStatement(parent) || Node.isForInStatement(parent)) return parent.getInitializer() === root;
  return isUpdated(parent) || Node.isDeleteExpression(parent);
};

export const accessOf = (reference: Node): Node | undefined => {
  const parent = reference.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference) return parent;
  if (Node.isElementAccessExpression(parent) && parent.getArgumentExpression() === reference) return parent;
  return undefined;
};

const literalKeyText = (key: Node | undefined): string | undefined =>
  Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key) ? key.getLiteralText() : undefined;

const isLiteralTypeOf = (type: Type, name: string): boolean => type.isStringLiteral() && type.getLiteralValue() === name;

const keyTypeIncludes = (key: Node, name: string): boolean => {
  const type = key.getType();
  return isLiteralTypeOf(type, name) || type.getUnionTypes().some((member) => isLiteralTypeOf(member, name));
};

export const isKeyFor = (key: Node | undefined, name: string): boolean =>
  key !== undefined && (literalKeyText(unwrap(key)) === name || keyTypeIncludes(key, name));

const isAssignKey = (key: Node | undefined): boolean => isKeyFor(key, 'assign');

const isAssignAccess = (callee: Node): boolean =>
  (Node.isIdentifier(callee) && callee.getText() === 'assign') ||
  (Node.isPropertyAccessExpression(callee) && callee.getName() === 'assign') ||
  (Node.isElementAccessExpression(callee) && isAssignKey(callee.getArgumentExpression()));

const isAssignOntoThis = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const [target] = node.getArguments();
  return isAssignAccess(unwrap(node.getExpression())) && target !== undefined && Node.isThisExpression(unwrap(target));
};

const isLiteralKey = (key: Node | undefined): boolean =>
  Node.isStringLiteral(key) || Node.isNumericLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key);

const isComputedWriteOnThis = (node: Node): boolean =>
  Node.isElementAccessExpression(node) &&
  Node.isThisExpression(unwrap(node.getExpression())) &&
  !isLiteralKey(node.getArgumentExpression()) &&
  isWritten(outermostWrapper(node));

export const writesUnknownMembers = (cls: ClassDeclaration): boolean =>
  cls.getDescendantsOfKind(SyntaxKind.CallExpression).some(isAssignOntoThis) ||
  cls.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).some(isComputedWriteOnThis);

export const isDecorated = (cls: ClassDeclaration): boolean => cls.getDecorators().length > 0;

const writtenBracketAccess =
  (name: string) =>
  (access: ElementAccessExpression): readonly Node[] => {
    const target = outermostWrapper(access);
    return isWritten(target) && isKeyFor(access.getArgumentExpression(), name) ? [target] : [];
  };

export const bracketWritesOf = (name: string, files: readonly SourceFile[]): readonly Node[] =>
  files.flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).flatMap(writtenBracketAccess(name)));
