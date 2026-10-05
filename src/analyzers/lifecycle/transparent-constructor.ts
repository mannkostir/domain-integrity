import {
  ClassDeclaration,
  ConstructorDeclaration,
  NewExpression,
  Node,
  ParameterDeclaration,
  PropertyDeclaration,
  Symbol as MorphSymbol,
  SyntaxKind,
} from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from './library';

type Store = { readonly field: string; readonly value: Node };

const NO_PARAMETERS: ReadonlySet<MorphSymbol> = new Set();

const declarationsOf = (node: Node): readonly Node[] => {
  const symbol = node.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations() ?? [];
};

const isUndefinedKeyword = (node: Node): boolean =>
  Node.isIdentifier(node) && node.getText() === 'undefined' && declarationsOf(node).length === 0;

const isLiteral = (node: Node): boolean =>
  Node.isStringLiteral(node) ||
  Node.isNumericLiteral(node) ||
  Node.isBigIntLiteral(node) ||
  Node.isTrueLiteral(node) ||
  Node.isFalseLiteral(node) ||
  Node.isNullLiteral(node) ||
  Node.isNoSubstitutionTemplateLiteral(node) ||
  isUndefinedKeyword(node);

const isDefaultLibraryConstruction = (node: Node): boolean => {
  if (!Node.isNewExpression(node)) return false;
  const callee = node.getExpression();
  const declarations = Node.isIdentifier(callee) ? declarationsOf(callee) : [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode) && node.getArguments().every(isLiteral);
};

const isParameterReference = (node: Node, parameters: ReadonlySet<MorphSymbol>): boolean => {
  const symbol = Node.isIdentifier(node) ? node.getSymbol() : undefined;
  return symbol !== undefined && parameters.has(symbol);
};

const isPlainValue = (node: Node, parameters: ReadonlySet<MorphSymbol>): boolean =>
  isLiteral(node) || isDefaultLibraryConstruction(node) || isParameterReference(node, parameters);

const PROTOTYPE_FIELD = '__proto__';

const unquoted = (name: string): string => name.replace(/^(['"`])(.*)\1$/, '$2');

const parameterProperties = (cls: ClassDeclaration): readonly ParameterDeclaration[] =>
  cls.getConstructors().flatMap((ctor) => ctor.getParameters().filter((parameter) => parameter.isParameterProperty()));

const instanceProperties = (cls: ClassDeclaration): readonly PropertyDeclaration[] =>
  cls.getProperties().filter((property) => !property.isStatic());

const declaresAccessor = (cls: ClassDeclaration): boolean =>
  cls.getGetAccessors().length > 0 ||
  cls.getSetAccessors().length > 0 ||
  cls.getProperties().some((property) => property.hasModifier(SyntaxKind.AccessorKeyword));

const declaresPrototypeField = (cls: ClassDeclaration): boolean =>
  [...instanceProperties(cls), ...parameterProperties(cls)].some((field) => unquoted(field.getName()) === PROTOTYPE_FIELD);

const hasInterceptingMember = (chain: readonly ClassDeclaration[]): boolean =>
  chain.some((cls) => declaresAccessor(cls) || declaresPrototypeField(cls));

const isPlainField = (chain: readonly ClassDeclaration[], name: string): boolean =>
  chain.some((cls) => cls.getProperty(name)?.isStatic() === false || parameterProperties(cls).some((parameter) => parameter.getName() === name));

const storeOf = (expression: Node): Store | undefined => {
  if (!Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return undefined;
  const target = expression.getLeft();
  return Node.isPropertyAccessExpression(target) && Node.isThisExpression(target.getExpression())
    ? { field: target.getName(), value: expression.getRight() }
    : undefined;
};

const isPlainSuperCall = (expression: Node, parameters: ReadonlySet<MorphSymbol>): boolean =>
  Node.isCallExpression(expression) &&
  Node.isSuperExpression(expression.getExpression()) &&
  expression.getArguments().every((argument) => isPlainValue(argument, parameters));

const isPlainStatement = (
  statement: Node,
  chain: readonly ClassDeclaration[],
  parameters: ReadonlySet<MorphSymbol>,
): boolean => {
  if (!Node.isExpressionStatement(statement)) return false;
  const expression = statement.getExpression();
  const store = storeOf(expression);
  return store === undefined
    ? isPlainSuperCall(expression, parameters)
    : isPlainField(chain, store.field) && isPlainValue(store.value, parameters);
};

const isPlainParameter = (parameter: ParameterDeclaration): boolean => {
  const initializer = parameter.getInitializer();
  return (
    Node.isIdentifier(parameter.getNameNode()) &&
    !parameter.isRestParameter() &&
    (initializer === undefined || isPlainValue(initializer, NO_PARAMETERS))
  );
};

const parameterSymbols = (ctor: ConstructorDeclaration): ReadonlySet<MorphSymbol> =>
  new Set(
    ctor.getParameters().flatMap((parameter) => {
      const symbol = parameter.getSymbol();
      return symbol === undefined ? [] : [symbol];
    }),
  );

const isPlainConstructor = (ctor: ConstructorDeclaration, chain: readonly ClassDeclaration[]): boolean => {
  const body = ctor.getBody();
  const parameters = parameterSymbols(ctor);
  return (
    Node.isBlock(body) &&
    ctor.getParameters().every(isPlainParameter) &&
    body.getStatements().every((statement) => isPlainStatement(statement, chain, parameters))
  );
};

const hasPlainInitializers = (cls: ClassDeclaration): boolean =>
  instanceProperties(cls).every((property) => {
    const initializer = property.getInitializer();
    return initializer === undefined || isPlainValue(initializer, NO_PARAMETERS);
  });

const isPlainClass = (cls: ClassDeclaration, chain: readonly ClassDeclaration[]): boolean =>
  !cls.hasDeclareKeyword() &&
  cls.getDescendantsOfKind(SyntaxKind.Decorator).length === 0 &&
  hasPlainInitializers(cls) &&
  cls
    .getConstructors()
    .filter((ctor) => ctor.getBody() !== undefined)
    .every((ctor) => isPlainConstructor(ctor, chain));

const classNamedBy = (reference: Node): ClassDeclaration | undefined => {
  const declarations = Node.isIdentifier(reference) ? declarationsOf(reference) : [];
  const [only] = declarations;
  return declarations.length === 1 && Node.isClassDeclaration(only) ? only : undefined;
};

const constructionChain = (cls: ClassDeclaration): readonly ClassDeclaration[] | undefined => {
  if (isLibraryNode(cls)) return undefined;
  const heritage = cls.getExtends();
  if (heritage === undefined) return [cls];
  const base = classNamedBy(heritage.getExpression());
  const rest = base === undefined ? undefined : constructionChain(base);
  return rest === undefined ? undefined : [cls, ...rest];
};

const constructedClass = (expression: NewExpression): ClassDeclaration | undefined =>
  classNamedBy(expression.getExpression());

export const isTransparentConstruction = (expression: NewExpression): boolean => {
  const cls = constructedClass(expression);
  const chain = cls === undefined ? undefined : constructionChain(cls);
  return chain !== undefined && !hasInterceptingMember(chain) && chain.every((member) => isPlainClass(member, chain));
};
