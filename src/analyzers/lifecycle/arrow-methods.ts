import { ArrowFunction, ClassDeclaration, Node, PropertyDeclaration } from 'ts-morph';
import { isLibraryNode } from '../shared/library';
import { NameUses } from '../shared/name-uses';

export type ArrowMethods = ReadonlyMap<PropertyDeclaration, ArrowFunction>;

const hasPlainName = (property: PropertyDeclaration): boolean => {
  const name = property.getNameNode();
  return Node.isIdentifier(name) || Node.isPrivateIdentifier(name);
};

const isPlainInstanceProperty = (property: PropertyDeclaration): boolean =>
  !isLibraryNode(property) &&
  !property.isStatic() &&
  !property.isAbstract() &&
  !property.hasDeclareKeyword() &&
  !property.hasAccessorKeyword() &&
  property.getDecorators().length === 0 &&
  hasPlainName(property);

const arrowMethodOf =
  (uses: NameUses) =>
  (property: PropertyDeclaration): readonly (readonly [PropertyDeclaration, ArrowFunction])[] => {
    const initializer = property.getInitializer();
    return Node.isArrowFunction(initializer) && isPlainInstanceProperty(property) && uses.isOnlyCalled(property.getName())
      ? [[property, initializer]]
      : [];
  };

export const arrowMethods = (family: readonly ClassDeclaration[], uses: NameUses): ArrowMethods =>
  new Map(family.flatMap((cls) => cls.getProperties()).flatMap(arrowMethodOf(uses)));
