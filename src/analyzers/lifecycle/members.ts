import { ClassDeclaration, ClassInstanceMemberTypes, GetAccessorDeclaration, Node, SetAccessorDeclaration } from 'ts-morph';
import { ancestry } from '../shared/ancestry';
import { isLibraryNode } from '../shared/library';
import { ArrowMethods } from './arrow-methods';
import { InstanceMethod, MethodResolution, resolveDeclaredMethod, resolveInstanceMethod } from './instance-method';

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

const methodNames =
  (arrows: ArrowMethods) =>
  (cls: ClassDeclaration): readonly string[] =>
    cls
      .getInstanceMembers()
      .filter((member) => Node.isMethodDeclaration(member) || (Node.isPropertyDeclaration(member) && arrows.has(member)))
      .map((member) => member.getName());

type MethodResolver = (chain: readonly ClassDeclaration[], name: string) => InstanceMethod | undefined;

const resolvedMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
  arrows: ArrowMethods,
  resolve: MethodResolver,
): readonly InstanceMethod[] => {
  const chain = projectHierarchy(cls, aggregateBaseClasses);
  return [...new Set(chain.flatMap(methodNames(arrows)))].flatMap((name) => resolve(chain, name) ?? []);
};

export const instanceMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
  resolution: MethodResolution,
): readonly InstanceMethod[] =>
  resolvedMethods(cls, aggregateBaseClasses, resolution.arrowMethods, (chain, name) =>
    resolveInstanceMethod(chain, name, resolution),
  );

export const declaredInstanceMethods = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
  arrows: ArrowMethods,
): readonly InstanceMethod[] =>
  resolvedMethods(cls, aggregateBaseClasses, arrows, (chain, name) => resolveDeclaredMethod(chain, name, arrows));

const isDeclaredMethod = (member: ClassInstanceMemberTypes): boolean =>
  Node.isMethodDeclaration(member) || (Node.isPropertyDeclaration(member) && Node.isArrowFunction(member.getInitializer()));

export const declaredMethodNames = (cls: ClassDeclaration, aggregateBaseClasses: readonly string[]): ReadonlySet<string> =>
  new Set(
    projectHierarchy(cls, aggregateBaseClasses).flatMap((candidate) =>
      candidate
        .getInstanceMembers()
        .filter(isDeclaredMethod)
        .map((member) => member.getName()),
    ),
  );

export const instanceAccessors = (
  cls: ClassDeclaration,
  aggregateBaseClasses: readonly string[],
): readonly (GetAccessorDeclaration | SetAccessorDeclaration)[] =>
  projectHierarchy(cls, aggregateBaseClasses)
    .flatMap((candidate) => [...candidate.getGetAccessors(), ...candidate.getSetAccessors()])
    .filter((accessor) => !accessor.isStatic());
