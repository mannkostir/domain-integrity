import { ClassDeclaration, ClassExpression, Decorator, Node, Symbol as MorphSymbol } from 'ts-morph';
import { decoratorName } from './decorator-name';

type InertPackage = { readonly path: RegExp; readonly names: ReadonlySet<string> };

const INERT_PACKAGES: readonly InertPackage[] = [
  {
    path: /\/node_modules\/typeorm\//,
    names: new Set(['Entity', 'ChildEntity', 'TableInheritance', 'Index', 'Unique', 'Check', 'Exclusion', 'Tree']),
  },
  { path: /\/node_modules\/@mikro-orm\/[^/]+\//, names: new Set(['Entity', 'Embeddable', 'Index', 'Unique', 'Filter']) },
];

const calleeOf = (decorator: Decorator): Node => {
  const expression = decorator.getExpression();
  return Node.isCallExpression(expression) ? expression.getExpression() : expression;
};

const resolveAliases = (symbol: MorphSymbol): MorphSymbol => {
  const target = symbol.getAliasedSymbol();
  return target === undefined || target === symbol ? symbol : resolveAliases(target);
};

const referencedSymbol = (callee: Node): MorphSymbol | undefined => {
  const name = Node.isIdentifier(callee) ? callee : Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : undefined;
  const symbol = name?.getSymbol();
  return symbol === undefined ? undefined : resolveAliases(symbol);
};

const isDeclaredBy = (symbol: MorphSymbol, inertPackage: InertPackage): boolean => {
  const declarations = symbol.getDeclarations();
  return (
    inertPackage.names.has(symbol.getName()) &&
    declarations.length > 0 &&
    declarations.every((declaration) => inertPackage.path.test(declaration.getSourceFile().getFilePath()))
  );
};

const isBuiltInInert = (decorator: Decorator): boolean => {
  const symbol = referencedSymbol(calleeOf(decorator));
  return symbol !== undefined && INERT_PACKAGES.some((inertPackage) => isDeclaredBy(symbol, inertPackage));
};

const isConfiguredInert = (decorator: Decorator, inertDecorators: readonly string[]): boolean => {
  const name = decoratorName(decorator);
  return name !== undefined && inertDecorators.includes(name);
};

const isInert = (decorator: Decorator, inertDecorators: readonly string[]): boolean =>
  isBuiltInInert(decorator) || isConfiguredInert(decorator, inertDecorators);

export const hasUnknownClassDecorator = (cls: ClassDeclaration | ClassExpression, inertDecorators: readonly string[]): boolean =>
  cls.getDecorators().some((decorator) => !isInert(decorator, inertDecorators));
