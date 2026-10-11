import { ClassDeclaration, Node } from 'ts-morph';
import { ancestry } from '../shared/ancestry';
import { hasCyclicInheritance } from '../shared/cyclic-heritage';
import { ProjectClasses } from './keys';

export type Hierarchy = { readonly ancestors: readonly ClassDeclaration[]; readonly extendsForeign: boolean; readonly opaque: boolean };

const ROOT: Hierarchy = { ancestors: [], extendsForeign: false, opaque: false };
const FOREIGN: Hierarchy = { ancestors: [], extendsForeign: true, opaque: false };
const OPAQUE: Hierarchy = { ancestors: [], extendsForeign: true, opaque: true };

const isPlainReference = (expression: Node): boolean => Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression);

const projectBase =
  (isProject: ProjectClasses) =>
  (cls: ClassDeclaration): ClassDeclaration | undefined => {
    const extended = cls.getExtends();
    if (extended === undefined || !isPlainReference(extended.getExpression())) return undefined;
    const base = cls.getBaseClass();
    return base !== undefined && isProject(base) ? base : undefined;
  };

const topOf = (top: ClassDeclaration): Hierarchy => {
  const extended = top.getExtends();
  if (extended === undefined) return ROOT;
  return isPlainReference(extended.getExpression()) ? FOREIGN : OPAQUE;
};

export const hierarchyOf = (cls: ClassDeclaration, isProject: ProjectClasses): Hierarchy => {
  if (hasCyclicInheritance(cls)) return OPAQUE;
  const { chain } = ancestry(cls, projectBase(isProject));
  return { ...topOf(chain.at(-1) ?? cls), ancestors: chain.slice(1) };
};
