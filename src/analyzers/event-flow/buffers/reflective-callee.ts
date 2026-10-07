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

const isReflectiveInterfaceMember = (owner: string, member: string): boolean =>
  (owner === 'ObjectConstructor' && REFLECTIVE_OBJECT_METHODS.has(member)) || (owner === 'JSON' && member === 'stringify');

const isInReflectNamespace = (declaration: Node): boolean =>
  declaration.getAncestors().some((ancestor) => Node.isModuleDeclaration(ancestor) && ancestor.getName() === 'Reflect');

const isReflectiveShape = (declaration: Node): boolean => {
  const parent = declaration.getParent();
  if (Node.isMethodSignature(declaration) && Node.isInterfaceDeclaration(parent)) {
    return isReflectiveInterfaceMember(parent.getName(), declaration.getName());
  }
  return Node.isFunctionDeclaration(declaration) && (declaration.getName() === 'structuredClone' || isInReflectNamespace(declaration));
};

const isReflectiveDeclaration = (declaration: Node): boolean =>
  isReflectiveShape(declaration) && isDefaultLibraryNode(declaration);

export const isReflectiveCallee = (callee: Node): boolean =>
  [...symbolDeclarations(callee), ...signatureDeclarations(callee)].some(isReflectiveDeclaration);
