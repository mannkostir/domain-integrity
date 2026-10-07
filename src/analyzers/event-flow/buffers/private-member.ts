import { Node, SyntaxKind } from 'ts-morph';

export const isPrivateMember = (member: Node): boolean =>
  (Node.isModifierable(member) && member.hasModifier(SyntaxKind.PrivateKeyword)) ||
  (Node.hasName(member) && Node.isPrivateIdentifier(member.getNameNode()));
