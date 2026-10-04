import { ClassDeclaration, Symbol as MorphSymbol, Node, Type } from 'ts-morph';
import { SET, UNSET, isNullish, literalToken } from '../../engine/value-token';
import { aggregateName } from './discover';
import { mayBeFalsy } from './falsy';
import { EnumReference, StateField, StateFieldKind, StateValue, UnsetForm } from './model';

export type FieldResolution =
  | { readonly kind: 'resolved'; readonly field: StateField }
  | { readonly kind: 'problem'; readonly message: string };

const SUPPORTED = 'supported state types are an enum, a string or number literal union, boolean, and a nullable non-literal type such as Date | null (requires strictNullChecks)';

export const isDataProperty = (symbol: MorphSymbol): boolean =>
  symbol
    .getDeclarations()
    .some((node) => Node.isPropertyDeclaration(node) || Node.isPropertySignature(node) || Node.isParameterDeclaration(node));

const propsMember = (cls: ClassDeclaration, name: string): MorphSymbol | undefined =>
  cls.getType().getProperty('props')?.getTypeAtLocation(cls).getProperty(name);

const fieldType = (cls: ClassDeclaration, name: string): Type | undefined =>
  (cls.getType().getProperty(name) ?? propsMember(cls, name))?.getTypeAtLocation(cls);

export const isAccessor = (node: Node): boolean => Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node);

const isAccessorOnly = (cls: ClassDeclaration, name: string): boolean => {
  const own = cls.getType().getProperty(name);
  const props = propsMember(cls, name);
  if (own === undefined || isDataProperty(own) || (props !== undefined && isDataProperty(props))) return false;
  return own.getDeclarations().some(isAccessor);
};

const resolved = (
  name: string,
  kind: StateFieldKind,
  values: readonly StateValue[],
  enumReference: EnumReference | undefined = undefined,
): FieldResolution => ({ kind: 'resolved', field: { name, kind, values, enumReference, unsetForms: [], setMayBeFalsy: false } });

const unsetFormsOf = (members: readonly Type[]): readonly UnsetForm[] => [
  ...(members.some((member) => member.isNull()) ? (['null'] as const) : []),
  ...(members.some((member) => member.isUndefined()) ? (['undefined'] as const) : []),
];

const enumMember = (type: Type) => type.getSymbol()?.getDeclarations().find((node) => Node.isEnumMember(node));

const enumValue = (type: Type): StateValue => {
  const member = enumMember(type);
  const token = literalToken(type) ?? type.getText();
  if (!Node.isEnumMember(member)) return { token, label: token, source: type.getText() };
  return { token, label: member.getName(), source: `${member.getParent().getName()}.${member.getName()}` };
};

const enumReferenceOf = (type: Type): EnumReference | undefined => {
  const member = enumMember(type);
  if (!Node.isEnumMember(member)) return undefined;
  const declaration = member.getParent();
  return { name: declaration.getName(), file: declaration.getSourceFile().getFilePath() };
};

const literalSource = (token: string, type: Type): string => (type.isNumberLiteral() ? token : `'${token.replace(/'/g, "\\'")}'`);

const literalValue = (type: Type): StateValue => {
  const token = literalToken(type) ?? type.getText();
  return { token, label: token, source: literalSource(token, type) };
};

const BOOLEAN_VALUES: readonly StateValue[] = [
  { token: 'true', label: 'true', source: 'true' },
  { token: 'false', label: 'false', source: 'false' },
];

const NULLABLE_VALUES: readonly StateValue[] = [
  { token: SET, label: SET, source: `'${SET}'` },
  { token: UNSET, label: UNSET, source: `'${UNSET}'` },
];

const resolvedNullable = (name: string, members: readonly Type[], setMayBeFalsy: boolean): FieldResolution => ({
  kind: 'resolved',
  field: { name, kind: 'nullable', values: NULLABLE_VALUES, enumReference: undefined, unsetForms: unsetFormsOf(members), setMayBeFalsy },
});

export const resolveStateField = (cls: ClassDeclaration, name: string): FieldResolution => {
  if (isAccessorOnly(cls, name)) {
    return { kind: 'problem', message: `${aggregateName(cls)}.${name} is an accessor; declare its backing field instead` };
  }
  const type = fieldType(cls, name);
  if (!type) return { kind: 'problem', message: `${aggregateName(cls)} has no field "${name}"` };
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const present = members.filter((member) => !isNullish(member));
  const nullable = present.length < members.length;
  if (!nullable && present.length > 0 && present.every((member) => member.isBooleanLiteral())) {
    return resolved(name, 'boolean', BOOLEAN_VALUES);
  }
  if (!nullable && present.length > 0 && present.every((member) => member.isEnumLiteral())) {
    return resolved(name, 'enum', present.map(enumValue), enumReferenceOf(present[0] as Type));
  }
  if (!nullable && present.length > 0 && present.every((member) => member.isStringLiteral() || member.isNumberLiteral())) {
    return resolved(name, 'union', present.map(literalValue));
  }
  if (nullable && present.length > 0 && present.every((member) => literalToken(member) === undefined)) {
    return resolvedNullable(name, members, mayBeFalsy(cls.getProject().getTypeChecker().compilerObject, present));
  }
  return {
    kind: 'problem',
    message: `${aggregateName(cls)}.${name} has unsupported type "${type.getText()}"; ${SUPPORTED}`,
  };
};
