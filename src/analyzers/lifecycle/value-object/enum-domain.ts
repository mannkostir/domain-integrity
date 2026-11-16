import { EnumDeclaration, Node, Type } from 'ts-morph';
import { literalToken } from '../../../engine/value-token';
import { isLibraryNode } from '../../shared/library';
import { ScalarValue } from './model';

export type EnumDomain = { readonly declaration: EnumDeclaration; readonly values: readonly ScalarValue[] };

export const enumDomain = (type: Type): EnumDomain | undefined => {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const values = members.flatMap((member): readonly ScalarValue[] => {
    const declarations = member.getSymbol()?.getDeclarations() ?? [];
    const [declaration] = declarations;
    const token = literalToken(member);
    if (!Node.isEnumMember(declaration)) return [];
    const name = declaration.getNameNode();
    if ((Node.isStringLiteral(name) ? name.getLiteralText() : name.getText()) === '__proto__') return [];
    return member.isEnumLiteral() && declarations.length === 1 && Node.isEnumMember(declaration) &&
      token !== undefined && !isLibraryNode(declaration)
      ? [{ token, label: declaration.getName(), member: declaration }]
      : [];
  });
  const first = values[0];
  if (values.length !== members.length || first === undefined) return undefined;
  const declaration = first.member.getParent();
  if (values.some(value => value.member.getParent() !== declaration)) return undefined;
  if (declaration.getMembers().length !== values.length) return undefined;
  return { declaration, values };
};
