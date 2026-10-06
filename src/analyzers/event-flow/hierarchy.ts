import { ClassDeclaration, Node } from 'ts-morph';
import { ProjectClasses } from './keys';

export type Hierarchy = { readonly ancestors: readonly ClassDeclaration[]; readonly extendsForeign: boolean };

const FOREIGN: Hierarchy = { ancestors: [], extendsForeign: true };

const isPlainReference = (expression: Node): boolean => Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression);

export const hierarchyOf = (cls: ClassDeclaration, isProject: ProjectClasses): Hierarchy => {
  const extended = cls.getExtends();
  if (extended === undefined) return { ancestors: [], extendsForeign: false };
  if (!isPlainReference(extended.getExpression())) return FOREIGN;
  const base = cls.getBaseClass();
  if (base === undefined || !isProject(base)) return FOREIGN;
  const above = hierarchyOf(base, isProject);
  return { ancestors: [base, ...above.ancestors], extendsForeign: above.extendsForeign };
};
