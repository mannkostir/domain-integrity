import { ArrowFunction, FunctionExpression, MethodDeclaration, Node, ParameterDeclaration, Type, TypeNode } from 'ts-morph';
import { hasNominalMember } from './nominal-members';
import { mentionsTypeParameter } from './type-parameter-use';

export type HandlerBound = { readonly kind: 'unbounded' } | { readonly kind: 'types'; readonly types: readonly Type[] };

export type HandlerSignature = MethodDeclaration | ArrowFunction | FunctionExpression;

export const UNBOUNDED: HandlerBound = { kind: 'unbounded' };

const signaturesOf = (handler: HandlerSignature): readonly HandlerSignature[] =>
  Node.isMethodDeclaration(handler) ? [...handler.getOverloads(), handler] : [handler];

const hasRequiredMember = (type: Type): boolean => type.getApparentType().getProperties().some((property) => !property.isOptional());

const isConstraining = (type: Type): boolean => !type.isAny() && !type.isUnknown() && !type.isTypeParameter() && hasRequiredMember(type);

const membersOf = (type: Type): readonly Type[] => (type.isUnion() ? type.getUnionTypes() : [type]);

const soleParameter = (signature: HandlerSignature): ParameterDeclaration | undefined => {
  const parameters = signature.getParameters().filter((parameter) => parameter.getName() !== 'this');
  const [parameter] = parameters;
  return parameters.length === 1 && parameter !== undefined && !parameter.isRestParameter() ? parameter : undefined;
};

const isComparableBound = (annotation: TypeNode, type: Type): boolean =>
  !mentionsTypeParameter(annotation) && !hasNominalMember(type) && membersOf(type).every(isConstraining);

const boundOfParameter = (parameter: ParameterDeclaration): HandlerBound => {
  const annotation = parameter.getTypeNode();
  if (annotation === undefined) return UNBOUNDED;
  const type = parameter.getType().getNonNullableType();
  return isComparableBound(annotation, type) ? { kind: 'types', types: [type] } : UNBOUNDED;
};

const boundOfSignature = (signature: HandlerSignature): HandlerBound => {
  const parameter = soleParameter(signature);
  return parameter === undefined ? UNBOUNDED : boundOfParameter(parameter);
};

type TypesBound = Extract<HandlerBound, { readonly kind: 'types' }>;

const isTypes = (bound: HandlerBound): bound is TypesBound => bound.kind === 'types';

const combined = (bounds: readonly HandlerBound[]): HandlerBound => {
  const typed = bounds.filter(isTypes);
  return typed.length === bounds.length ? { kind: 'types', types: typed.flatMap((bound) => bound.types) } : UNBOUNDED;
};

export const handlerBound = (handler: HandlerSignature | undefined): HandlerBound =>
  handler === undefined ? UNBOUNDED : combined(signaturesOf(handler).map(boundOfSignature));
