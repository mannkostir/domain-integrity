import { Node, Symbol as MorphSymbol, SyntaxKind, Type } from 'ts-morph';

const hasRestrictedScope = (declaration: Node): boolean =>
  Node.isModifierable(declaration) && (declaration.hasModifier(SyntaxKind.PrivateKeyword) || declaration.hasModifier(SyntaxKind.ProtectedKeyword));

const hasPrivateName = (declaration: Node): boolean => Node.isPropertyNamed(declaration) && Node.isPrivateIdentifier(declaration.getNameNode());

const isNominal = (property: MorphSymbol): boolean => property.getDeclarations().some((declaration) => hasRestrictedScope(declaration) || hasPrivateName(declaration));

const constituentsOf = (type: Type): readonly Type[] => [type, ...type.getUnionTypes(), ...type.getIntersectionTypes()];

export const hasNominalMember = (type: Type): boolean => constituentsOf(type).some((constituent) => constituent.getProperties().some(isNominal));
