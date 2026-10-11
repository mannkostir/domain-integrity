import { ClassDeclaration, GetAccessorDeclaration, MethodDeclaration, SetAccessorDeclaration } from 'ts-morph';
import { isLibraryNode } from '../shared/library';

const inheritedClasses = (cls: ClassDeclaration, aggregateBaseClasses: ReadonlySet<string>): readonly ClassDeclaration[] => {
  const base = cls.getBaseClass();
  if (base === undefined || isLibraryNode(base) || aggregateBaseClasses.has(base.getName() ?? '')) return [];
  return [base, ...inheritedClasses(base, aggregateBaseClasses)];
};

export const projectHierarchy = (cls: ClassDeclaration, aggregateBaseClasses: readonly string[]): readonly ClassDeclaration[] => [
  cls,
  ...inheritedClasses(cls, new Set(aggregateBaseClasses)),
];

export const instanceMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
): readonly MethodDeclaration[] => {
  const byName = projectHierarchy(cls, aggregateBaseClasses)
    .flatMap((candidate) => candidate.getInstanceMethods())
    .reduce<ReadonlyMap<string, MethodDeclaration>>(
      (found, method) => (found.has(method.getName()) ? found : new Map([...found, [method.getName(), method]])),
      new Map(),
    );
  return [...byName.values()];
};

export const instanceAccessors = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
): readonly (GetAccessorDeclaration | SetAccessorDeclaration)[] =>
  projectHierarchy(cls, aggregateBaseClasses)
    .flatMap((candidate) => [...candidate.getGetAccessors(), ...candidate.getSetAccessors()])
    .filter((accessor) => !accessor.isStatic());
