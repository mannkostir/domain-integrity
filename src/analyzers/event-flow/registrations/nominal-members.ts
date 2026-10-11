import { Node, Symbol as MorphSymbol, SyntaxKind, Type } from 'ts-morph';
import { someReachable } from './reachable-types';

const hasRestrictedScope = (declaration: Node): boolean =>
  Node.isModifierable(declaration) && (declaration.hasModifier(SyntaxKind.PrivateKeyword) || declaration.hasModifier(SyntaxKind.ProtectedKeyword));

const hasPrivateName = (declaration: Node): boolean => Node.isPropertyNamed(declaration) && Node.isPrivateIdentifier(declaration.getNameNode());

const isNominal = (property: MorphSymbol): boolean => property.getDeclarations().some((declaration) => hasRestrictedScope(declaration) || hasPrivateName(declaration));

const declaresNominalMember = (type: Type): boolean => type.getProperties().some(isNominal);

export const hasNominalMember = (type: Type, location: Node): boolean => someReachable(type, location, declaresNominalMember);
