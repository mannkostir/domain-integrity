import { ClassDeclaration } from 'ts-morph';
import { isLibraryNode } from '../shared/library';
import { classNamedBy } from '../shared/named-class';

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
