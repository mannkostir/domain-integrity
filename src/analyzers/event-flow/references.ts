import { ClassDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { Location } from './model';

export type ReferenceContext = {
  readonly analysed: ReadonlySet<SourceFile>;
  readonly isTest: (file: SourceFile) => boolean;
  readonly keys: ReadonlySet<Node>;
};

export type ReferenceFacts = {
  readonly constructions: readonly Location[];
  readonly subclassed: boolean;
  readonly escaped: boolean;
  readonly instanceofChecked: boolean;
  readonly typedParameter: boolean;
  readonly namedInString: boolean;
};

type Use = 'construction' | 'test-construction' | 'quiet' | 'extends' | 'instanceof' | 'typed-parameter' | 'escape';

const isKey = (reference: Node, keys: ReadonlySet<Node>): boolean => {
  const parent = reference.getParent();
  return keys.has(reference) || (Node.isPropertyAccessExpression(parent) && parent.getName() === 'name' && keys.has(parent));
};

const isExtendsClause = (reference: Node): boolean => {
  const clause = reference.getParent();
  const heritage = clause?.getParent();
  return Node.isExpressionWithTypeArguments(clause) && Node.isHeritageClause(heritage) && heritage.getToken() === SyntaxKind.ExtendsKeyword;
};

const inParameterType = (reference: Node): boolean => {
  const parameter = reference.getFirstAncestorByKind(SyntaxKind.Parameter);
  const typeNode = parameter?.getTypeNode();
  return typeNode !== undefined && typeNode.getPos() <= reference.getPos() && reference.getEnd() <= typeNode.getEnd();
};

const inTypePosition = (reference: Node): boolean => {
  const typeNode = reference.getFirstAncestor((ancestor) => Node.isTypeNode(ancestor));
  if (typeNode === undefined) return false;
  return !Node.isExpressionWithTypeArguments(typeNode) || reference.getParent() === typeNode;
};

const isImportOrExportSpecifier = (reference: Node): boolean =>
  reference.getFirstAncestor((ancestor) => Node.isImportDeclaration(ancestor) || Node.isExportSpecifier(ancestor)) !== undefined;

const useOf = (reference: Node, context: ReferenceContext): Use => {
  const parent = reference.getParent();
  if (Node.isNewExpression(parent) && parent.getExpression() === reference) {
    return context.isTest(reference.getSourceFile()) ? 'test-construction' : 'construction';
  }
  if (isKey(reference, context.keys) || isImportOrExportSpecifier(reference)) return 'quiet';
  if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.InstanceOfKeyword && parent.getRight() === reference) {
    return 'instanceof';
  }
  if (isExtendsClause(reference)) return 'extends';
  if (inParameterType(reference)) return 'typed-parameter';
  if (inTypePosition(reference)) return 'quiet';
  return 'escape';
};

const constructsItself = (cls: ClassDeclaration): boolean =>
  cls.getDescendantsOfKind(SyntaxKind.NewExpression).some((expression) => {
    const target = expression.getExpression();
    return Node.isThisExpression(target) || (Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression()));
  });

const namedInString = (cls: ClassDeclaration, analysed: ReadonlySet<SourceFile>): boolean => {
  const name = cls.getName();
  return [...analysed].some((file) =>
    file
      .getDescendants()
      .some((node) => (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) && node.getLiteralText() === name),
  );
};

export const referenceFacts = (cls: ClassDeclaration, context: ReferenceContext): ReferenceFacts => {
  const references = cls
    .findReferencesAsNodes()
    .filter((reference) => context.analysed.has(reference.getSourceFile()) && reference !== cls.getNameNode());
  const uses = references.map((reference) => ({ reference, use: useOf(reference, context) }));
  const has = (use: Use): boolean => uses.some((entry) => entry.use === use);
  return {
    constructions: uses
      .filter((entry) => entry.use === 'construction')
      .map(({ reference }) => ({ file: reference.getSourceFile().getFilePath(), line: reference.getStartLineNumber() })),
    subclassed: has('extends'),
    escaped: has('escape') || constructsItself(cls),
    instanceofChecked: has('instanceof'),
    typedParameter: has('typed-parameter'),
    namedInString: namedInString(cls, context.analysed),
  };
};
