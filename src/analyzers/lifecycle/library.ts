import { Node } from 'ts-morph';

export const isLibraryNode = (node: Node): boolean => {
  const file = node.getSourceFile();
  return file.isDeclarationFile() || file.isInNodeModules() || file.isFromExternalLibrary();
};
