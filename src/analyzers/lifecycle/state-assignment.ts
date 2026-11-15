import { BinaryExpression, ClassDeclaration, Expression, Node, Symbol as MorphSymbol, SyntaxKind } from 'ts-morph';
import { fieldNameOf, hasAmbiguousInstanceShape, hasAmbiguousPrivateField, hasForeignThis, resolveSetter } from './field-ref';
import { namedClassChain } from './named-chain';
import { isLibraryNode } from '../shared/library';
import { unwrap } from '../shared/wrappers';

const dataDeclarations = (symbol: MorphSymbol | undefined): readonly Node[] | undefined => {
  const declarations = symbol?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every((declaration) =>
    !isLibraryNode(declaration) &&
    (Node.isPropertySignature(declaration) || Node.isPropertyAssignment(declaration) || Node.isShorthandPropertyAssignment(declaration) ||
      (Node.isPropertyDeclaration(declaration) && !declaration.isStatic() && declaration.getDecorators().length === 0) ||
      Node.isParameterDeclaration(declaration))) ? declarations : undefined;
};

const memberSymbol = (target: Node): MorphSymbol | undefined => {
  if (Node.isPropertyAccessExpression(target)) return target.getNameNode().getSymbol();
  if (Node.isElementAccessExpression(target)) {
    const name = target.getArgumentExpression();
    return Node.isStringLiteral(name) ? target.getExpression().getType().getProperty(name.getLiteralText()) : undefined;
  }
  return undefined;
};

export const isPlainDataPathFromThis = (expression: Node): boolean => {
  const target = unwrap(expression);
  if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return false;
  const holder = unwrap(target.getExpression());
  return dataDeclarations(memberSymbol(target)) !== undefined &&
    (Node.isThisExpression(holder) || isPlainDataPathFromThis(holder));
};

export const isTrackedDataDestination = (target: Node, field: string, cls: ClassDeclaration): boolean => {
  if (fieldNameOf(target) !== field || !isPlainDataPathFromThis(target)) return false;
  if (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) {
    const holder = unwrap(target.getExpression());
    if (Node.isPropertyAccessExpression(holder) || Node.isElementAccessExpression(holder)) {
      const declaredHolder = dataDeclarations(cls.getType().getProperty('props'));
      const actualHolder = dataDeclarations(memberSymbol(holder));
      if (declaredHolder === undefined || actualHolder === undefined ||
        !declaredHolder.every((declaration) => actualHolder.includes(declaration))) return false;
    }
  }
  const selected = cls.getType().getProperty(field) ?? cls.getType().getProperty('props')?.getTypeAtLocation(cls).getProperty(field);
  const declarations = dataDeclarations(selected);
  const actual = dataDeclarations(memberSymbol(target));
  return declarations !== undefined && actual !== undefined &&
    declarations.length === actual.length && declarations.every((declaration) => actual.includes(declaration));
};

const isConstant = (value: Node): value is Expression =>
  Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value) || Node.isNumericLiteral(value) ||
  Node.isTrueLiteral(value) || Node.isFalseLiteral(value) || Node.isNullLiteral(value) ||
  (Node.isPropertyAccessExpression(value) && Node.isIdentifier(value.getExpression()) &&
    (value.getExpression().getSymbol()?.getDeclarations() ?? []).some(Node.isEnumDeclaration) &&
    (value.getNameNode().getSymbol()?.getDeclarations() ?? []).some(Node.isEnumMember));

const inInstanceContext = (node: Node): boolean => {
  const binder = node.getFirstAncestor((ancestor) =>
    Node.isMethodDeclaration(ancestor) || Node.isGetAccessorDeclaration(ancestor) ||
    Node.isSetAccessorDeclaration(ancestor) || Node.isPropertyDeclaration(ancestor) ||
    Node.isConstructorDeclaration(ancestor) || Node.isClassStaticBlockDeclaration(ancestor));
  return binder !== undefined && !Node.isClassStaticBlockDeclaration(binder) &&
    (Node.isConstructorDeclaration(binder) || !binder.isStatic()) && !hasForeignThis(node);
};

export type StateAssignment = { readonly value: Expression };

export const assignedSetter = (expression: Node, cls: ClassDeclaration) => {
  if (!inInstanceContext(expression)) return undefined;
  const target = unwrap(expression);
  if (!Node.isPropertyAccessExpression(target) && !Node.isElementAccessExpression(target)) return undefined;
  const receiver = unwrap(target.getExpression());
  if (!Node.isThisExpression(receiver) && !Node.isSuperExpression(receiver)) return undefined;
  const name = fieldNameOf(target) ?? (Node.isPropertyAccessExpression(target) ? target.getName() : undefined);
  return name === undefined ? undefined : resolveSetter(cls, target, name);
};

export const setterStateAssignment = (
  binary: BinaryExpression,
  field: string,
  cls: ClassDeclaration,
): StateAssignment | undefined => {
  if (binary.getOperatorToken().getKind() !== SyntaxKind.EqualsToken || hasAmbiguousPrivateField(cls, field)) return undefined;
  const chain = namedClassChain(cls);
  if (chain === undefined || chain.some((candidate) => isLibraryNode(candidate) || hasAmbiguousInstanceShape(candidate))) return undefined;
  const setter = assignedSetter(binary.getLeft(), cls);
  if (setter?.kind !== 'resolved' || isLibraryNode(setter.declaration)) return undefined;
  const parameters = setter.declaration.getParameters();
  const parameter = parameters[0];
  if (parameters.length !== 1 || parameter === undefined || !Node.isIdentifier(parameter.getNameNode()) ||
    parameter.getInitializer() !== undefined || parameter.isRestParameter() || parameter.getDecorators().length > 0) return undefined;
  const body = setter.declaration.getBody();
  if (!Node.isBlock(body)) return undefined;
  const statements = body.getStatements();
  const statement = statements[0];
  if (statements.length !== 1 || !Node.isExpressionStatement(statement)) return undefined;
  const assignment = unwrap(statement.getExpression());
  if (!Node.isBinaryExpression(assignment) || assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
    !isTrackedDataDestination(unwrap(assignment.getLeft()), field, cls)) return undefined;
  const value = unwrap(assignment.getRight());
  if (Node.isIdentifier(value) && value.getSymbol() === parameter.getSymbol()) return { value: binary.getRight() };
  return isConstant(value) ? { value } : undefined;
};
