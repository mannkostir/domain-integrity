import { ClassDeclaration, MethodDeclaration } from 'ts-morph';
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

export const instanceMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
): readonly MethodDeclaration[] => {
  const hierarchy = ancestry(cls, inheritedBase(new Set(aggregateBaseClasses))).chain;
  const byName = hierarchy
    .flatMap((candidate) => candidate.getInstanceMethods())
    .reduce<ReadonlyMap<string, MethodDeclaration>>(
      (found, method) => (found.has(method.getName()) ? found : new Map([...found, [method.getName(), method]])),
      new Map(),
    );
  return [...byName.values()];
};
