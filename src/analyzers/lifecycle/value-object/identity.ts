import { ClassDeclaration, Node, ParameterDeclaration, Symbol as MorphSymbol } from 'ts-morph';
import { isLibraryNode } from '../../shared/library';
import { MAX_PROJECTION_DEPTH } from './model';

export const resolvedSymbol = (node: Node): MorphSymbol | undefined => {
  const symbol = node.getSymbol();
  return symbol?.getAliasedSymbol() ?? symbol;
};

export const refersTo = (node: Node, declaration: Node): boolean => {
  const declarations = resolvedSymbol(node)?.getDeclarations() ?? [];
  return declarations.length === 1 && declarations[0] === declaration;
};

export const isDeclarationReference = (node: Node, depth = 0): boolean => {
  if (depth >= MAX_PROJECTION_DEPTH) return false;
  if (Node.isIdentifier(node)) return true;
  if (!Node.isPropertyAccessExpression(node) || node.hasQuestionDotToken()) return false;
  const receiver = node.getExpression();
  const declarations = resolvedSymbol(receiver)?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(declaration => Node.isModuleDeclaration(declaration) || Node.isSourceFile(declaration)) &&
    isDeclarationReference(receiver, depth + 1);
};

export const referencedClass = (node: Node): ClassDeclaration | undefined => {
  if (!isDeclarationReference(node)) return undefined;
  const declarations = resolvedSymbol(node)?.getDeclarations() ?? [];
  const [only] = declarations;
  return declarations.length === 1 && Node.isClassDeclaration(only) && !isLibraryNode(only) ? only : undefined;
};

export const simpleParameter = (parameters: readonly ParameterDeclaration[]): ParameterDeclaration | undefined => {
  const [only] = parameters;
  return parameters.length === 1 && only !== undefined && Node.isIdentifier(only.getNameNode()) &&
    !only.isRestParameter() && !only.isOptional() && !only.isParameterProperty() && only.getInitializer() === undefined &&
    only.getDecorators().length === 0 ? only : undefined;
};
