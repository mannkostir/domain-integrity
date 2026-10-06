import { ClassDeclaration } from 'ts-morph';
import { ProjectClasses } from './keys';

export type Hierarchy = { readonly ancestors: readonly ClassDeclaration[]; readonly extendsForeign: boolean };

export const hierarchyOf = (cls: ClassDeclaration, isProject: ProjectClasses): Hierarchy => {
  if (cls.getExtends() === undefined) return { ancestors: [], extendsForeign: false };
  const base = cls.getBaseClass();
  if (base === undefined || !isProject(base)) return { ancestors: [], extendsForeign: true };
  const above = hierarchyOf(base, isProject);
  return { ancestors: [base, ...above.ancestors], extendsForeign: above.extendsForeign };
};
