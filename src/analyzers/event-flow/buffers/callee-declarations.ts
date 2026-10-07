import { Node } from 'ts-morph';

export const symbolDeclarations = (expression: Node): readonly Node[] => {
  const symbol = expression.getSymbol();
  const resolved = symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol;
  return resolved?.getDeclarations() ?? [];
};

export const signatureDeclarations = (expression: Node): readonly Node[] =>
  expression
    .getType()
    .getCallSignatures()
    .flatMap((signature) => (signature.compilerSignature.declaration === undefined ? [] : [signature.getDeclaration()]));
