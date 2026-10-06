import { ClassDeclaration, Node } from 'ts-morph';
import { ProjectClasses } from './keys';

export type Hierarchy = { readonly ancestors: readonly ClassDeclaration[]; readonly extendsForeign: boolean; readonly opaque: boolean };

const ROOT: Hierarchy = { ancestors: [], extendsForeign: false, opaque: false };
const FOREIGN: Hierarchy = { ancestors: [], extendsForeign: true, opaque: false };
const OPAQUE: Hierarchy = { ancestors: [], extendsForeign: true, opaque: true };

const isPlainReference = (expression: Node): boolean => Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression);

export const hierarchyOf = (cls: ClassDeclaration, isProject: ProjectClasses): Hierarchy => {
  const extended = cls.getExtends();
  if (extended === undefined) return ROOT;
  if (!isPlainReference(extended.getExpression())) return OPAQUE;
  const base = cls.getBaseClass();
  if (base === undefined || !isProject(base)) return FOREIGN;
  const above = hierarchyOf(base, isProject);
  return { ...above, ancestors: [base, ...above.ancestors] };
};
