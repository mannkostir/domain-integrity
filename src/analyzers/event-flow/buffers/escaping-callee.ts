import { Node, ts } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../../shared/library';
import { unwrap } from '../../shared/wrappers';
import { signatureDeclarations, symbolDeclarations } from './callee-declarations';
import { isDeepReflectiveCallee, isShallowReflectiveCallee } from './reflective-callee';

const FUNCTION_FORWARDERS: ReadonlySet<string> = new Set(['call', 'apply', 'bind']);
const FUNCTION_INTERFACES: ReadonlySet<string> = new Set(['Function', 'CallableFunction', 'NewableFunction']);

const isForeignLibraryNode = (node: Node): boolean => isLibraryNode(node) && !isDefaultLibraryNode(node);

const isFunctionInterfaceMember = (declaration: Node): boolean => {
  const parent = declaration.getParent();
  return Node.isInterfaceDeclaration(parent) && FUNCTION_INTERFACES.has(parent.getName()) && isDefaultLibraryNode(declaration);
};

const forwardedFunction = (callee: Node): Node | undefined => {
  const target = unwrap(callee);
  return Node.isPropertyAccessExpression(target) &&
    FUNCTION_FORWARDERS.has(target.getName()) &&
    symbolDeclarations(target).some(isFunctionInterfaceMember)
    ? target.getExpression()
    : undefined;
};

const judgedCallee = (callee: Node): Node => {
  const forwarded = forwardedFunction(callee);
  return forwarded === undefined ? callee : judgedCallee(forwarded);
};

const isInGlobalAugmentation = (declaration: Node): boolean =>
  declaration
    .getAncestors()
    .some((ancestor) => Node.isModuleDeclaration(ancestor) && (ancestor.compilerNode.flags & ts.NodeFlags.GlobalAugmentation) !== 0);

const isInGlobalScript = (declaration: Node): boolean => !ts.isExternalModule(declaration.getSourceFile().compilerNode);

const isAmbientGlobal = (declaration: Node): boolean =>
  isDefaultLibraryNode(declaration) || isInGlobalAugmentation(declaration) || isInGlobalScript(declaration);

const isGlobalConsoleDeclaration = (declaration: Node): boolean =>
  Node.isVariableDeclaration(declaration) &&
  declaration.getName() === 'console' &&
  isLibraryNode(declaration) &&
  isAmbientGlobal(declaration);

const isConsoleReference = (node: Node): boolean => {
  const declarations = symbolDeclarations(unwrap(node));
  return declarations.length > 0 && declarations.every(isGlobalConsoleDeclaration);
};

const isConsoleCallee = (callee: Node): boolean => {
  const target = unwrap(callee);
  return Node.isPropertyAccessExpression(target) && isConsoleReference(target.getExpression());
};

const isAllForeign = (declarations: readonly Node[]): boolean =>
  declarations.length > 0 && declarations.every(isForeignLibraryNode);

const isForeignCallee = (callee: Node): boolean => {
  const declarations = symbolDeclarations(callee);
  return (
    callee.getType().isAny() ||
    declarations.length === 0 ||
    isAllForeign(declarations) ||
    isAllForeign(signatureDeclarations(callee))
  );
};

export type CalleeReach = 'none' | 'surface' | 'deep';

export const calleeReach = (callee: Node): CalleeReach => {
  const judged = judgedCallee(callee);
  if (isConsoleCallee(judged)) return 'none';
  if (isDeepReflectiveCallee(judged) || isForeignCallee(judged)) return 'deep';
  return isShallowReflectiveCallee(judged) ? 'surface' : 'none';
};
