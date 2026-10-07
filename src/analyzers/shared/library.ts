import { Node } from 'ts-morph';

export const isLibraryNode = (node: Node): boolean => {
  const file = node.getSourceFile();
  return file.isDeclarationFile() || file.isInNodeModules() || file.isFromExternalLibrary();
};

export const isDefaultLibraryNode = (node: Node): boolean =>
  node.getProject().getProgram().compilerObject.isSourceFileDefaultLibrary(node.getSourceFile().compilerNode);
