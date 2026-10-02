import { EnumDeclaration, Identifier, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { StateField } from './model';

const COMPARISON_OPERATORS: readonly SyntaxKind[] = [
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
];

const isInsideTypeNode = (node: Node): boolean => {
  for (const ancestor of node.getAncestors()) {
    if (Node.isExpressionWithTypeArguments(ancestor)) return false;
    if (Node.isTypeNode(ancestor)) return true;
  }
  return false;
};

const isComparisonOperand = (node: Node): boolean => {
  const parent = node.getParent();
  return Node.isBinaryExpression(parent) && COMPARISON_OPERATORS.includes(parent.getOperatorToken().getKind());
};

const isCaseLabel = (node: Node): boolean => {
  const parent = node.getParent();
  return Node.isCaseClause(parent) && parent.getExpression() === node;
};

const isInside = (node: Node, container: Node | undefined): boolean =>
  container !== undefined && node.getFirstAncestor((ancestor) => ancestor === container) !== undefined;

const isValuePosition = (node: Node, ownEnum: EnumDeclaration | undefined): boolean =>
  !isInsideTypeNode(node) && !isComparisonOperand(node) && !isCaseLabel(node) && !isInside(node, ownEnum);

const isModuleBinding = (identifier: Identifier): boolean => {
  const parent = identifier.getParent();
  return (
    Node.isImportSpecifier(parent) ||
    Node.isExportSpecifier(parent) ||
    Node.isImportClause(parent) ||
    Node.isNamespaceImport(parent) ||
    Node.isEnumDeclaration(parent)
  );
};

const refersTo = (identifier: Identifier, enumDeclaration: EnumDeclaration): boolean => {
  const symbol = identifier.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations().includes(enumDeclaration) ?? false;
};

const findEnum = (files: readonly SourceFile[], field: StateField): EnumDeclaration | undefined =>
  files
    .filter((file) => file.getFilePath() === field.enumReference?.file)
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.EnumDeclaration))
    .find((declaration) => declaration.getName() === field.enumReference?.name);

const allTokens = (field: StateField): string[] => field.values.map((value) => value.token);

const memberToken = (field: StateField, memberName: string | undefined): string[] =>
  field.values.filter((value) => value.label === memberName).map((value) => value.token);

const accessedMember = (identifier: Identifier): { readonly access: Node; readonly name: string | undefined } => {
  const parent = identifier.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === identifier) {
    return { access: parent, name: parent.getName() };
  }
  if (Node.isElementAccessExpression(parent) && parent.getExpression() === identifier) {
    const argument = parent.getArgumentExpression();
    const literal = Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument);
    return { access: parent, name: literal ? argument.getLiteralValue() : undefined };
  }
  return { access: identifier, name: undefined };
};

const referencedTokens = (
  file: SourceFile,
  field: StateField,
  enumDeclaration: EnumDeclaration,
): string[] =>
  file
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((identifier) => !isModuleBinding(identifier))
    .filter((identifier) => refersTo(identifier, enumDeclaration))
    .map(accessedMember)
    .filter(({ access }) => isValuePosition(access, enumDeclaration))
    .flatMap(({ name }) => (name === undefined ? allTokens(field) : memberToken(field, name)));

const literalTokens = (file: SourceFile, field: StateField, ownEnum: EnumDeclaration | undefined): string[] => {
  const known = new Set(allTokens(field));
  return [
    ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.NumericLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]
    .filter((literal) => isValuePosition(literal, ownEnum))
    .map((literal) => String(literal.getLiteralValue()))
    .filter((token) => known.has(token));
};

const tokensIn = (file: SourceFile, field: StateField, enumDeclaration: EnumDeclaration | undefined): string[] => {
  if (field.kind === 'enum') {
    const references = enumDeclaration ? referencedTokens(file, field, enumDeclaration) : [];
    return [...references, ...literalTokens(file, field, enumDeclaration)];
  }
  if (field.kind === 'union') return literalTokens(file, field, undefined);
  return [];
};

export const mentionedTokens = (files: readonly SourceFile[], field: StateField): ReadonlySet<string> => {
  const enumDeclaration = findEnum(files, field);
  return new Set(files.flatMap((file) => tokensIn(file, field, enumDeclaration)));
};
