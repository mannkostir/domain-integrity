import { ClassDeclaration, Node } from 'ts-morph';

export type ProjectClasses = (cls: ClassDeclaration) => boolean;

export type KeyResolution =
  | { readonly kind: 'project'; readonly cls: ClassDeclaration }
  | { readonly kind: 'foreign' }
  | { readonly kind: 'unresolved' };

const UNRESOLVED: KeyResolution = { kind: 'unresolved' };

const classOf = (identifier: Node): ClassDeclaration | undefined =>
  Node.isIdentifier(identifier) ? identifier.getDefinitionNodes().find((node) => Node.isClassDeclaration(node)) : undefined;

const referencedIdentifier = (expression: Node): Node | undefined => {
  if (Node.isIdentifier(expression)) return expression;
  if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'name' && Node.isIdentifier(expression.getExpression())) {
    return expression.getExpression();
  }
  return undefined;
};

export const resolveKey = (expression: Node, isProject: ProjectClasses): KeyResolution => {
  const identifier = referencedIdentifier(expression);
  const cls = identifier === undefined ? undefined : classOf(identifier);
  if (cls === undefined) return UNRESOLVED;
  return isProject(cls) ? { kind: 'project', cls } : { kind: 'foreign' };
};
