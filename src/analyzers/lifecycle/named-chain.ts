import { ClassDeclaration, Node } from 'ts-morph';
import { isLibraryNode } from './library';

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

const chainFrom = (
  cls: ClassDeclaration,
  visited: ReadonlySet<ClassDeclaration>,
): readonly ClassDeclaration[] | undefined => {
  if (visited.has(cls)) return undefined;
  const heritage = cls.getExtends();
  if (isLibraryNode(cls) || heritage === undefined) return [cls];
  const base = classNamedBy(heritage.getExpression());
  const rest = base === undefined ? undefined : chainFrom(base, new Set([...visited, cls]));
  return rest === undefined ? undefined : [cls, ...rest];
};

export const namedClassChain = (cls: ClassDeclaration): readonly ClassDeclaration[] | undefined =>
  chainFrom(cls, new Set());
