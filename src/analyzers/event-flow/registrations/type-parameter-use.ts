import { Node, Type, TypeNode, ts } from 'ts-morph';

const declaresTypeParameter = (reference: Node): boolean =>
  Node.isTypeReference(reference) && (reference.getTypeName().getSymbol()?.getDeclarations() ?? []).some(Node.isTypeParameterDeclaration);

const annotationReferencesTypeParameter = (annotation: TypeNode): boolean => [annotation, ...annotation.getDescendants()].some(declaresTypeParameter);

const constituentsOf = (type: Type): readonly Type[] => [
  ...type.getUnionTypes(),
  ...type.getIntersectionTypes(),
  ...type.getTypeArguments(),
  ...type.getAliasTypeArguments(),
];

const involvesTypeParameter = (type: Type, visited: ReadonlySet<ts.Type>): boolean => {
  if (visited.has(type.compilerType)) return false;
  if (type.isTypeParameter()) return true;
  const seen = new Set([...visited, type.compilerType]);
  return constituentsOf(type).some((constituent) => involvesTypeParameter(constituent, seen));
};

export const mentionsTypeParameter = (annotation: TypeNode): boolean =>
  annotationReferencesTypeParameter(annotation) || involvesTypeParameter(annotation.getType(), new Set());
