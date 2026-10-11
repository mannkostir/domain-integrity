import { ArrowFunction, FunctionExpression, MethodDeclaration, Node, ParameterDeclaration, Type } from 'ts-morph';

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

const boundOfSignature = (signature: HandlerSignature): HandlerBound => {
  const parameter = soleParameter(signature);
  if (parameter === undefined) return UNBOUNDED;
  const type = parameter.getType().getNonNullableType();
  return membersOf(type).every(isConstraining) ? { kind: 'types', types: [type] } : UNBOUNDED;
};

type TypesBound = Extract<HandlerBound, { readonly kind: 'types' }>;

const isTypes = (bound: HandlerBound): bound is TypesBound => bound.kind === 'types';

const combined = (bounds: readonly HandlerBound[]): HandlerBound => {
  const typed = bounds.filter(isTypes);
  return typed.length === bounds.length ? { kind: 'types', types: typed.flatMap((bound) => bound.types) } : UNBOUNDED;
};

export const handlerBound = (handler: HandlerSignature | undefined): HandlerBound =>
  handler === undefined ? UNBOUNDED : combined(signaturesOf(handler).map(boundOfSignature));
