import { Node } from 'ts-morph';
import { isDefaultLibraryNode } from '../../shared/library';
import { signatureDeclarations, symbolDeclarations } from './callee-declarations';

const REFLECTIVE_OBJECT_METHODS: ReadonlySet<string> = new Set([
  'keys',
  'values',
  'entries',
  'assign',
  'getOwnPropertyNames',
  'getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors',
]);

const interfaceMember = (declaration: Node, owner: string): string | undefined => {
  const parent = declaration.getParent();
  return Node.isMethodSignature(declaration) && Node.isInterfaceDeclaration(parent) && parent.getName() === owner
    ? declaration.getName()
    : undefined;
};

const FORWARDING_REFLECT_FUNCTIONS: ReadonlySet<string> = new Set(['apply', 'construct']);

const isInReflectNamespace = (declaration: Node): boolean =>
  declaration.getAncestors().some((ancestor) => Node.isModuleDeclaration(ancestor) && ancestor.getName() === 'Reflect');

const isReflectFunction = (declaration: Node): boolean =>
  Node.isFunctionDeclaration(declaration) && isInReflectNamespace(declaration);

const isForwardingReflectFunction = (declaration: Node): boolean =>
  Node.isFunctionDeclaration(declaration) && FORWARDING_REFLECT_FUNCTIONS.has(declaration.getName() ?? '');

const isShallowReflectiveShape = (declaration: Node): boolean => {
  const member = interfaceMember(declaration, 'ObjectConstructor');
  return (member !== undefined && REFLECTIVE_OBJECT_METHODS.has(member)) || (isReflectFunction(declaration) && !isForwardingReflectFunction(declaration));
};

const isDeepReflectiveShape = (declaration: Node): boolean =>
  interfaceMember(declaration, 'JSON') === 'stringify' ||
  (Node.isFunctionDeclaration(declaration) && declaration.getName() === 'structuredClone') ||
  (isReflectFunction(declaration) && isForwardingReflectFunction(declaration));

const calleeDeclarations = (callee: Node): readonly Node[] => [...symbolDeclarations(callee), ...signatureDeclarations(callee)];

const isDeclaredAs = (callee: Node, shape: (declaration: Node) => boolean): boolean =>
  calleeDeclarations(callee).some((declaration) => shape(declaration) && isDefaultLibraryNode(declaration));

export const isShallowReflectiveCallee = (callee: Node): boolean => isDeclaredAs(callee, isShallowReflectiveShape);

export const isDeepReflectiveCallee = (callee: Node): boolean => isDeclaredAs(callee, isDeepReflectiveShape);
