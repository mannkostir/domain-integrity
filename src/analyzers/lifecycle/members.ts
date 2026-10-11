import { ClassDeclaration, GetAccessorDeclaration, MethodDeclaration, SetAccessorDeclaration } from 'ts-morph';
import { ancestry } from '../shared/ancestry';
import { isLibraryNode } from '../shared/library';

const isInheritedFrom = (base: ClassDeclaration, aggregateBaseClasses: ReadonlySet<string>): boolean =>
  !isLibraryNode(base) && !aggregateBaseClasses.has(base.getName() ?? '');

const inheritedBase =
  (aggregateBaseClasses: ReadonlySet<string>) =>
  (cls: ClassDeclaration): ClassDeclaration | undefined => {
    const base = cls.getBaseClass();
    return base !== undefined && isInheritedFrom(base, aggregateBaseClasses) ? base : undefined;
  };

const projectHierarchy = (cls: ClassDeclaration, aggregateBaseClasses: readonly string[]): readonly ClassDeclaration[] =>
  ancestry(cls, inheritedBase(new Set(aggregateBaseClasses))).chain;

const projectBase = (cls: ClassDeclaration): ClassDeclaration | undefined => {
  const base = cls.getBaseClass();
  return base !== undefined && !isLibraryNode(base) ? base : undefined;
};

export const projectAncestry = (cls: ClassDeclaration): readonly ClassDeclaration[] => ancestry(cls, projectBase).chain;

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
