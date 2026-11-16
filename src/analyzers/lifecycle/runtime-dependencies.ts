import { Node, Symbol as MorphSymbol } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../shared/library';

export const moduleMayExpose = (symbol: MorphSymbol | undefined, targets: readonly Node[]): boolean => {
  let remaining = 256;
  const visit = (candidate: MorphSymbol | undefined, active: ReadonlySet<MorphSymbol>, depth: number): boolean => {
    if (remaining-- <= 0) return true;
    if (candidate === undefined) return true;
    const resolved = candidate.getAliasedSymbol() ?? candidate;
    const declarations = resolved.getDeclarations();
    if (declarations.some(declaration => targets.includes(declaration))) return true;
    if (active.has(resolved)) return false;
    if (declarations.length === 0) return true;
    if (declarations.some(isLibraryNode) ||
      !declarations.every(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration))) return false;
    if (depth >= 5) return true;
    const next = new Set([...active, resolved]);
    return declarations[0]!.getProject().getTypeChecker().getExportsOfModule(resolved).some(exported => visit(exported, next, depth + 1));
  };
  return visit(symbol, new Set(), 0);
};

export const isRuntimeReference = (node: Node): boolean => {
  if (node.getAncestors().some(ancestor => Node.isTypeNode(ancestor) || Node.isImportDeclaration(ancestor) || Node.isExportDeclaration(ancestor))) return false;
  const parent = node.getParent();
  if (Node.isExportAssignment(parent) && parent.getExpression() === node) return false;
  return parent === undefined || !Node.hasName(parent) || Node.isShorthandPropertyAssignment(parent) || parent.getNameNode() !== node;
};

export type LibraryOperation = { readonly owner: 'Object' | 'Reflect'; readonly name: string };

export const defaultLibraryOperation = (declaration: Node | undefined): LibraryOperation | undefined => {
  if (declaration === undefined || !isDefaultLibraryNode(declaration) || !Node.hasName(declaration)) return undefined;
  const name = declaration.getNameNode();
  if (!Node.isIdentifier(name) && !Node.isStringLiteral(name)) return undefined;
  const operation = Node.isIdentifier(name) ? name.getText() : name.getLiteralText();
  if (declaration.getAncestors().some(ancestor => Node.isInterfaceDeclaration(ancestor) && ancestor.getName() === 'ObjectConstructor')) return { owner: 'Object', name: operation };
  if (declaration.getAncestors().some(ancestor => Node.isModuleDeclaration(ancestor) && ancestor.getName() === 'Reflect')) return { owner: 'Reflect', name: operation };
  return undefined;
};

export const defaultLibraryOperations = (call: import('ts-morph').CallExpression | import('ts-morph').NewExpression): readonly LibraryOperation[] => {
  const callee = call.getExpression();
  const declarations = [
    call.getProject().getTypeChecker().getResolvedSignature(call)?.getDeclaration(),
    ...callee.getType().getCallSignatures().map(signature => signature.getDeclaration()),
    ...(callee.getSymbol()?.getDeclarations() ?? []),
  ];
  return declarations.flatMap(declaration => {
    const operation = defaultLibraryOperation(declaration);
    return operation === undefined ? [] : [operation];
  });
};
