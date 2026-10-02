import { ClassDeclaration, MethodDeclaration } from 'ts-morph';
import { isLibraryNode } from './library';

const inheritedClasses = (cls: ClassDeclaration, aggregateBaseClasses: ReadonlySet<string>): readonly ClassDeclaration[] => {
  const base = cls.getBaseClass();
  if (base === undefined || isLibraryNode(base) || aggregateBaseClasses.has(base.getName() ?? '')) return [];
  return [base, ...inheritedClasses(base, aggregateBaseClasses)];
};

export const instanceMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
): readonly MethodDeclaration[] => {
  const hierarchy = [cls, ...inheritedClasses(cls, new Set(aggregateBaseClasses))];
  const byName = hierarchy
    .flatMap((candidate) => candidate.getInstanceMethods())
    .reduce<ReadonlyMap<string, MethodDeclaration>>(
      (found, method) => (found.has(method.getName()) ? found : new Map([...found, [method.getName(), method]])),
      new Map(),
    );
  return [...byName.values()];
};
