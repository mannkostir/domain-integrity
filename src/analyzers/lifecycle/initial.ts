import { CallExpression, ClassDeclaration, Node, SyntaxKind, Type } from 'ts-morph';
import { AssignedValueResolver, TrackedAssignmentTarget, assignedValue, setsOf } from './assigned';
import { JavaScriptDataProperties } from './javascript-data';
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

const objectLiteralValues = (literal: Node, field: StateField, resolver?: AssignedValueResolver): readonly AssignedValues[] => {
  if (!Node.isObjectLiteralExpression(literal)) return [];
  return literal.getProperties().flatMap((property): readonly AssignedValues[] => {
    if (Node.isShorthandPropertyAssignment(property)) return property.getName() === field.name ? [UNRESOLVED] : [];
    if (Node.isSpreadAssignment(property)) {
      return typeCarriesField(property.getExpression().getType(), field, property) ? [UNRESOLVED] : [];
    }
    if (!Node.isPropertyAssignment(property)) return [];
    const initializer = property.getInitializerOrThrow();
    if (property.getName() === field.name) return [assignedValue(initializer, field, resolver)];
    return objectLiteralValues(initializer, field, resolver);
  });
};

const argumentValues = (argument: Node, field: StateField, resolver?: AssignedValueResolver): readonly AssignedValues[] => {
  if (Node.isObjectLiteralExpression(argument)) return objectLiteralValues(argument, field, resolver);
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

export const initialValues = (cls: ClassDeclaration, field: StateField, resolver?: AssignedValueResolver, tracksTarget?: TrackedAssignmentTarget, javascriptData?: JavaScriptDataProperties): AssignedValues => {
  const symbol = cls.getType().getProperty(field.name);
  const proof = javascriptData?.prove(cls, symbol);
  if (proof?.kind === 'data') return mergeAssigned(proof.constructorAssignments.map(assignment => assignedValue(assignment.getRight(), field, resolver)));
  const unprovedImplicitData = proof?.kind === 'unknown' && symbol?.getDeclarations().some(Node.isBinaryExpression) === true;
  const initializer = cls.getProperty(field.name)?.getInitializer();
  const assignsWholeObject = cls.getConstructors().some((constructor) => OBJECT_ASSIGN_TO_THIS.test(constructor.getText()));
  const merged = mergeAssigned([
    ...cls.getConstructors().map((constructor) => setsOf(constructor, field, cls, resolver, tracksTarget, javascriptData)),
    ...(initializer ? [assignedValue(initializer, field, resolver)] : []),
    ...creationArguments(cls).flatMap((argument) => argumentValues(argument, field, resolver)),
    ...(assignsWholeObject || unprovedImplicitData ? [UNRESOLVED] : []),
  ]);
  return writesField(merged) || hasUnknownWrite(merged) ? merged : UNRESOLVED;
};
