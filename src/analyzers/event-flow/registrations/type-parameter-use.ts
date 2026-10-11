import { Node, TypeNode } from 'ts-morph';
import { hasGenericCallSignature, someReachable } from '../reachable-types';

const declaresTypeParameter = (reference: Node): boolean =>
  Node.isTypeReference(reference) && (reference.getTypeName().getSymbol()?.getDeclarations() ?? []).some(Node.isTypeParameterDeclaration);

const annotationReferencesTypeParameter = (annotation: TypeNode): boolean => [annotation, ...annotation.getDescendants()].some(declaresTypeParameter);

export const mentionsTypeParameter = (annotation: TypeNode): boolean =>
  annotationReferencesTypeParameter(annotation) || someReachable(annotation.getType(), annotation, (type) => type.isTypeParameter() || hasGenericCallSignature(type));
