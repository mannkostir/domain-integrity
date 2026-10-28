import {
  ArrowFunction,
  ClassDeclaration,
  ClassInstanceMemberTypes,
  CompilerOptions,
  MethodDeclaration,
  Node,
  PropertyDeclaration,
  ScriptTarget,
} from 'ts-morph';
import { NameUses } from '../shared/name-uses';
import { ArrowMethods } from './arrow-methods';

export type MethodImplementation = MethodDeclaration | ArrowFunction;

export type InstanceMethod = {
  readonly name: string;
  readonly member: MethodDeclaration | PropertyDeclaration;
  readonly implementation: MethodImplementation;
};

export type MethodResolution = {
  readonly arrowMethods: ArrowMethods;
  readonly nameUses: Pick<NameUses, 'isWritten'>;
};

export const declaredMethod = (method: MethodDeclaration): InstanceMethod => ({
  name: method.getName(),
  member: method,
  implementation: method,
});

const arrowMethod = (property: PropertyDeclaration, arrows: ArrowMethods): InstanceMethod | undefined => {
  const implementation = arrows.get(property);
  return implementation === undefined ? undefined : { name: property.getName(), member: property, implementation };
};

const isAccessor = (member: ClassInstanceMemberTypes): boolean =>
  Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member);

const emittedTarget = (options: CompilerOptions): ScriptTarget => options.target ?? ScriptTarget.LatestStandard;

const definesUninitialisedFields = (options: CompilerOptions): boolean =>
  options.useDefineForClassFields ?? emittedTarget(options) >= ScriptTarget.ES2022;

const setsOwnProperty = (property: PropertyDeclaration): boolean =>
  !property.hasDeclareKeyword() &&
  !property.isAbstract() &&
  (property.hasInitializer() || definesUninitialisedFields(property.getProject().getCompilerOptions()));

const isOwnProperty = (member: ClassInstanceMemberTypes): boolean =>
  Node.isParameterDeclaration(member) || (Node.isPropertyDeclaration(member) && setsOwnProperty(member));

const methodAmong = (members: readonly ClassInstanceMemberTypes[], arrows: ArrowMethods): InstanceMethod | undefined => {
  if (members.some(isAccessor)) return undefined;
  const property = members.find(isOwnProperty);
  if (property !== undefined) return Node.isPropertyDeclaration(property) ? arrowMethod(property, arrows) : undefined;
  const method = members.find(Node.isMethodDeclaration);
  return method === undefined ? undefined : declaredMethod(method);
};

export const resolveDeclaredMethod = (
  chain: readonly ClassDeclaration[],
  name: string,
  arrows: ArrowMethods,
): InstanceMethod | undefined =>
  methodAmong(
    chain.flatMap((cls) => cls.getInstanceMembers().filter((member) => member.getName() === name)),
    arrows,
  );

export const resolveInstanceMethod = (
  chain: readonly ClassDeclaration[],
  name: string,
  resolution: MethodResolution,
): InstanceMethod | undefined =>
  resolution.nameUses.isWritten(name) ? undefined : resolveDeclaredMethod(chain, name, resolution.arrowMethods);
