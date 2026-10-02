import { CallExpression, ClassDeclaration, Node, SyntaxKind, Type } from 'ts-morph';
import { assignedValue, setsOf } from './assigned';
import { AssignedValues, StateField } from './model';
import { UNRESOLVED, hasUnknownWrite, mergeAssigned, writesField } from './values';

const OBJECT_ASSIGN_TO_THIS = /Object\.assign\(\s*this\b/;
const STATE_HOLDER = 'props';

const isOpaque = (type: Type): boolean => type.isAny() || type.isUnknown();

const hasField = (type: Type, name: string): boolean =>
  isOpaque(type) || type.getStringIndexType() !== undefined || type.getProperty(name) !== undefined;

const typeCarriesField = (type: Type, field: StateField, at: Node): boolean => {
  if (type.isUnion()) return type.getUnionTypes().some((member) => typeCarriesField(member, field, at));
  if (hasField(type, field.name)) return true;
  const holder = type.getProperty(STATE_HOLDER);
  return holder !== undefined && typeCarriesField(holder.getTypeAtLocation(at), field, at);
};

const objectLiteralValues = (literal: Node, field: StateField): readonly AssignedValues[] => {
  if (!Node.isObjectLiteralExpression(literal)) return [];
  return literal.getProperties().flatMap((property): readonly AssignedValues[] => {
    if (Node.isShorthandPropertyAssignment(property)) return property.getName() === field.name ? [UNRESOLVED] : [];
    if (Node.isSpreadAssignment(property)) {
      return typeCarriesField(property.getExpression().getType(), field, property) ? [UNRESOLVED] : [];
    }
    if (!Node.isPropertyAssignment(property)) return [];
    const initializer = property.getInitializerOrThrow();
    if (property.getName() === field.name) return [assignedValue(initializer, field)];
    return objectLiteralValues(initializer, field);
  });
};

const argumentValues = (argument: Node, field: StateField): readonly AssignedValues[] => {
  if (Node.isObjectLiteralExpression(argument)) return objectLiteralValues(argument, field);
  return typeCarriesField(argument.getType(), field, argument) ? [UNRESOLVED] : [];
};

const isSuperCall = (call: CallExpression): boolean => call.getExpression().getKind() === SyntaxKind.SuperKeyword;

const creationArguments = (cls: ClassDeclaration): readonly Node[] => {
  const factoryCalls = cls
    .getStaticMethods()
    .flatMap((method) => method.getDescendantsOfKind(SyntaxKind.NewExpression))
    .filter((creation) => [cls.getName(), 'this'].includes(creation.getExpression().getText()))
    .flatMap((creation) => creation.getArguments());
  const superCalls = cls
    .getConstructors()
    .flatMap((constructor) => constructor.getDescendantsOfKind(SyntaxKind.CallExpression))
    .filter(isSuperCall)
    .flatMap((call) => call.getArguments());
  return [...factoryCalls, ...superCalls];
};

export const initialValues = (cls: ClassDeclaration, field: StateField): AssignedValues => {
  const initializer = cls.getProperty(field.name)?.getInitializer();
  const assignsWholeObject = cls.getConstructors().some((constructor) => OBJECT_ASSIGN_TO_THIS.test(constructor.getText()));
  const merged = mergeAssigned([
    ...cls.getConstructors().map((constructor) => setsOf(constructor, field)),
    ...(initializer ? [assignedValue(initializer, field)] : []),
    ...creationArguments(cls).flatMap((argument) => argumentValues(argument, field)),
    ...(assignsWholeObject ? [UNRESOLVED] : []),
  ]);
  return writesField(merged) || hasUnknownWrite(merged) ? merged : UNRESOLVED;
};
