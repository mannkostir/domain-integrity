import {
  ClassDeclaration,
  MethodDeclaration,
  Node,
  ParameterDeclaration,
  PropertyDeclaration,
  SourceFile,
  Symbol as MorphSymbol,
  SyntaxKind,
} from 'ts-morph';
import { isLibraryNode } from './library';
import { outermostWrapper, unwrap } from './wrappers';
import { accessOf, bracketWritesOf, destructuringRoot, isDecorated, isWritten, writesUnknownMembers } from './writes';

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

const isResetToEmpty = (target: Node): boolean => {
  const parent = target.getParent();
  return (
    Node.isBinaryExpression(parent) &&
    destructuringRoot(parent) === parent &&
    parent.getLeft() === target &&
    parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
    isEmptyArrayLiteral(parent.getRight())
  );
};

const isSafeReference = (reference: Node): boolean => {
  const access = accessOf(reference);
  if (access === undefined) return false;
  const target = outermostWrapper(access);
  return isResetToEmpty(target) || !isWritten(target);
};

const bracketName = (property: PropertyDeclaration): string | undefined => {
  const name = property.getNameNode();
  if (Node.isIdentifier(name)) return name.getText();
  return Node.isStringLiteral(name) ? name.getLiteralText() : undefined;
};

const isBracketWrittenIn = (property: PropertyDeclaration, files: readonly SourceFile[]): boolean => {
  const name = bracketName(property);
  return name !== undefined && bracketWritesOf(name, files).some((target) => !isResetToEmpty(target));
};

export const isPlainEventArray = (
  property: PropertyDeclaration,
  family: readonly ClassDeclaration[],
  files: readonly SourceFile[],
): boolean =>
  isPlainDeclaration(property) &&
  !family.some(isDecorated) &&
  !family.some(writesUnknownMembers) &&
  !isBracketWrittenIn(property, files) &&
  property
    .findReferencesAsNodes()
    .filter((reference) => reference !== property.getNameNode())
    .every(isSafeReference);

export const plainEventArrays = (family: readonly ClassDeclaration[], files: readonly SourceFile[]): ReadonlySet<Node> =>
  new Set(family.flatMap((cls) => cls.getProperties()).filter((property) => isPlainEventArray(property, family, files)));

const declarationsAreIn = (node: Node, arrays: ReadonlySet<Node>): boolean => {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every((declaration) => arrays.has(declaration));
};

export const isPlainArrayPush = (access: Node, arrays: ReadonlySet<Node>): boolean => {
  if (!Node.isPropertyAccessExpression(access) || !Node.isThisExpression(access.getExpression())) return false;
  const receiver = outermostWrapper(access);
  const member = receiver.getParent();
  const call = member?.getParent();
  return (
    !access.hasQuestionDotToken() &&
    Node.isPropertyAccessExpression(member) &&
    member.getExpression() === receiver &&
    member.getName() === 'push' &&
    !member.hasQuestionDotToken() &&
    Node.isCallExpression(call) &&
    call.getExpression() === member &&
    !call.hasQuestionDotToken() &&
    declarationsAreIn(access, arrays)
  );
};

const isPlainParameter = (parameter: ParameterDeclaration): boolean =>
  Node.isIdentifier(parameter.getNameNode()) &&
  !parameter.isRestParameter() &&
  parameter.getInitializer() === undefined &&
  parameter.getDecorators().length === 0;

const parameterSymbols = (method: MethodDeclaration): ReadonlySet<MorphSymbol> =>
  new Set(method.getParameters().flatMap((parameter) => parameter.getSymbol() ?? []));

const isParameterReference = (argument: Node, parameters: ReadonlySet<MorphSymbol>): boolean => {
  const symbol = Node.isIdentifier(argument) ? argument.getSymbol() : undefined;
  return symbol !== undefined && parameters.has(symbol);
};

const isPushOfParameters = (statement: Node, arrays: ReadonlySet<Node>, parameters: ReadonlySet<MorphSymbol>): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const call = statement.getExpression();
  if (!Node.isCallExpression(call)) return false;
  const member = call.getExpression();
  return (
    Node.isPropertyAccessExpression(member) &&
    isPlainArrayPush(member.getExpression(), arrays) &&
    call.getArguments().every((argument) => isParameterReference(argument, parameters))
  );
};

const bodyStatements = (method: MethodDeclaration): readonly Node[] => {
  const body = method.getBody();
  return Node.isBlock(body) ? body.getStatements() : [];
};

export const isPushOnlyMethod = (method: MethodDeclaration, arrays: ReadonlySet<Node>): boolean => {
  const statements = bodyStatements(method);
  const parameters = parameterSymbols(method);
  return (
    !method.isStatic() &&
    !method.isAsync() &&
    !method.isGenerator() &&
    method.getOverloads().length === 0 &&
    method.getDecorators().length === 0 &&
    method.getParameters().every(isPlainParameter) &&
    statements.length > 0 &&
    statements.every((statement) => isPushOfParameters(statement, arrays, parameters))
  );
};
