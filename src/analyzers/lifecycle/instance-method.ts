import { ArrowFunction, ClassDeclaration, ClassInstanceMemberTypes, MethodDeclaration, Node, PropertyDeclaration } from 'ts-morph';
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

const isInstanceProperty = (member: ClassInstanceMemberTypes): boolean =>
  Node.isPropertyDeclaration(member) || Node.isParameterDeclaration(member);

const methodAmong = (members: readonly ClassInstanceMemberTypes[], arrows: ArrowMethods): InstanceMethod | undefined => {
  if (members.some(isAccessor)) return undefined;
  const property = members.find(isInstanceProperty);
  if (property !== undefined) return Node.isPropertyDeclaration(property) ? arrowMethod(property, arrows) : undefined;
  const method = members.find(Node.isMethodDeclaration);
  return method === undefined ? undefined : declaredMethod(method);
};

export const resolveInstanceMethod = (
  chain: readonly ClassDeclaration[],
  name: string,
  resolution: MethodResolution,
): InstanceMethod | undefined =>
  resolution.nameUses.isWritten(name)
    ? undefined
    : methodAmong(
        chain.flatMap((cls) => cls.getInstanceMembers().filter((member) => member.getName() === name)),
        resolution.arrowMethods,
      );
