import { Node } from 'ts-morph';
import { isDefaultLibraryNode, isLibraryNode } from '../../shared/library';
import { unwrap } from '../../shared/wrappers';
import { symbolDeclarations } from './callee-declarations';
import { isReflectiveCallee } from './reflective-callee';

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

const isConsoleReference = (node: Node): boolean => {
  const target = unwrap(node);
  const named =
    (Node.isIdentifier(target) && target.getText() === 'console') ||
    (Node.isPropertyAccessExpression(target) && target.getName() === 'console');
  const declarations = symbolDeclarations(target);
  return named && declarations.length > 0 && declarations.every(isLibraryNode);
};

const isConsoleCallee = (callee: Node): boolean => {
  const target = unwrap(callee);
  return Node.isPropertyAccessExpression(target) && isConsoleReference(target.getExpression());
};

const isForeignCallee = (callee: Node): boolean => {
  const declarations = symbolDeclarations(callee);
  return callee.getType().isAny() || declarations.length === 0 || declarations.every(isForeignLibraryNode);
};

export const isEscapingCallee = (callee: Node): boolean => {
  const judged = judgedCallee(callee);
  return !isConsoleCallee(judged) && (isReflectiveCallee(judged) || isForeignCallee(judged));
};
