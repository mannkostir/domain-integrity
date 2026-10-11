import { EnumDeclaration, Identifier, Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../shared/source-index';
import { EnumReferences } from './enum-references';
import { StateField } from './model';
import { ProjectIndex } from './project-index';

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

const findEnum = (sources: SourceIndex, field: StateField): EnumDeclaration | undefined =>
  sources
    .ofKind(SyntaxKind.EnumDeclaration)
    .find(
      (declaration) =>
        declaration.getSourceFile().getFilePath() === field.enumReference?.file &&
        declaration.getName() === field.enumReference?.name,
    );

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

const referencedTokens = (references: EnumReferences, field: StateField, enumDeclaration: EnumDeclaration): string[] =>
  references
    .to(enumDeclaration)
    .map(accessedMember)
    .filter(({ access }) => isValuePosition(access, enumDeclaration))
    .flatMap(({ name }) => (name === undefined ? allTokens(field) : memberToken(field, name)));

const literalTokens = (sources: SourceIndex, field: StateField, ownEnum: EnumDeclaration | undefined): string[] =>
  [...new Set(allTokens(field))].filter((token) =>
    sources.literalsWithValue(token).some((literal) => isValuePosition(literal, ownEnum)),
  );

type MentionSources = Pick<ProjectIndex, 'sources' | 'enumReferences'>;

const enumTokens = (project: MentionSources, field: StateField): string[] => {
  const enumDeclaration = findEnum(project.sources, field);
  const references = enumDeclaration ? referencedTokens(project.enumReferences, field, enumDeclaration) : [];
  return [...references, ...literalTokens(project.sources, field, enumDeclaration)];
};

const tokensOf = (project: MentionSources, field: StateField): string[] => {
  if (field.kind === 'enum') return enumTokens(project, field);
  if (field.kind === 'union') return literalTokens(project.sources, field, undefined);
  return [];
};

export const mentionedTokens = (project: MentionSources, field: StateField): ReadonlySet<string> =>
  new Set(tokensOf(project, field));
