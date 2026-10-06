import { ClassDeclaration, Node, ParameterDeclaration, TypeNode } from 'ts-morph';
import { ProjectClasses } from './keys';

export type RawPayload =
  | { readonly kind: 'classes'; readonly classes: readonly ClassDeclaration[]; readonly node: Node }
  | { readonly kind: 'unreadable' };

const UNREADABLE: RawPayload = { kind: 'unreadable' };

const projectClassOf = (node: TypeNode, isProject: ProjectClasses): ClassDeclaration | undefined => {
  if (!Node.isTypeReference(node) || node.getTypeArguments().length > 0) return undefined;
  const name = node.getTypeName();
  const cls = Node.isIdentifier(name) ? name.getDefinitionNodes().find((definition) => Node.isClassDeclaration(definition)) : undefined;
  return Node.isClassDeclaration(cls) && isProject(cls) ? cls : undefined;
};

const members = (node: TypeNode): readonly TypeNode[] => (Node.isUnionTypeNode(node) ? node.getTypeNodes() : [node]);

export const readPayload = (parameter: ParameterDeclaration | undefined, isProject: ProjectClasses): RawPayload => {
  const typeNode = parameter?.getTypeNode();
  if (parameter === undefined || typeNode === undefined) return UNREADABLE;
  const classes = members(typeNode).map((member) => projectClassOf(member, isProject));
  return classes.every((cls): cls is ClassDeclaration => cls !== undefined) ? { kind: 'classes', classes, node: parameter } : UNREADABLE;
};
