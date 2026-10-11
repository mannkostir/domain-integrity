import { ClassDeclaration, Node } from 'ts-morph';

export const declarationsOf = (node: Node): readonly Node[] => {
  const symbol = node.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations() ?? [];
};

export const classNamedBy = (reference: Node): ClassDeclaration | undefined => {
  const declarations = Node.isIdentifier(reference) ? declarationsOf(reference) : [];
  const [only] = declarations;
  return declarations.length === 1 && Node.isClassDeclaration(only) ? only : undefined;
};
