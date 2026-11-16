import { Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { isDefaultLibraryNode } from '../../shared/library';
import { isWritten } from '../../shared/writes';
import { outermostWrapper } from '../../shared/wrappers';
import { ScalarProjection, MAX_PROJECTION_DEPTH } from './model';
import { refersTo, resolvedSymbol } from './identity';
import { moduleMayExpose } from '../runtime-dependencies';
import { proveWrapperPredicate } from './predicate';

const typePosition = (node: Node): boolean => node.getAncestors().some(ancestor =>
  Node.isTypeNode(ancestor) || Node.isImportDeclaration(ancestor) || Node.isExportDeclaration(ancestor));

const libraryMember = (node: Node): boolean => {
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  return declarations.length > 0 && declarations.every(isDefaultLibraryNode);
};

const pureEnumUse = (node: Node): boolean => {
  const expression = outermostWrapper(node);
  const parent = expression.getParent();
  if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === expression) return !isWritten(outermostWrapper(parent)) &&
    (parent.getNameNode().getSymbol()?.getDeclarations() ?? []).some(Node.isEnumMember);
  if (!Node.isCallExpression(parent)) return false;
  const callee = parent.getExpression();
  return Node.isPropertyAccessExpression(callee) && ['values', 'keys', 'entries'].includes(callee.getName()) && libraryMember(callee.getNameNode());
};

const supportedBodies = (projection: ScalarProjection): readonly Node[] => {
  const bodies: Node[] = projection.wrapper.getMethods().filter(method => proveWrapperPredicate(method, projection).kind === 'proven');
  let cls = projection.wrapper;
  for (let depth = 0; depth < MAX_PROJECTION_DEPTH; depth += 1) {
    bodies.push(...cls.getConstructors());
    const base = cls.getBaseClass();
    if (base === undefined) break;
    cls = base;
  }
  return bodies;
};

export const dependencyHazards = (projection: ScalarProjection, sources: SourceIndex): readonly Node[] => {
  const bodies = supportedBodies(projection);
  const includes = bodies.some(body => body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(access => access.getName() === 'includes' && libraryMember(access.getNameNode())));
  const values = bodies.some(body => body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(access => access.getName() === 'values' && libraryMember(access.getNameNode())));
  return sources.files.flatMap(file => file.getDescendants().filter(node => {
    if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return false;
    const owner = node.getParentOrThrow();
    if (typePosition(node) || (Node.hasName(owner) && !Node.isShorthandPropertyAssignment(owner) && owner.getNameNode() === node)) return false;
    if (refersTo(node, projection.enumDeclaration)) return isWritten(outermostWrapper(node)) || !pureEnumUse(node);
    const symbol = resolvedSymbol(node);
    const declarations = symbol?.getDeclarations() ?? [];
    if (declarations.some(declaration => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration)) && moduleMayExpose(symbol, [projection.wrapper, projection.enumDeclaration])) {
      const parent = node.getParent();
      return !Node.isPropertyAccessExpression(parent) || parent.getExpression() !== node || parent.getNameNode().getSymbol() === undefined || isWritten(outermostWrapper(parent));
    }
    if (!Node.isIdentifier(node) || !libraryMember(node) || !((includes && node.getText() === 'Array') || (values && node.getText() === 'Object'))) return false;
    const expression = outermostWrapper(node);
    const parent = expression.getParent();
    if (Node.isElementAccessExpression(parent) && parent.getExpression() === expression) return true;
    if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === expression) return parent.getName() === 'prototype' || isWritten(outermostWrapper(parent));
    return Node.isVariableDeclaration(parent) || Node.isCallExpression(parent);
  }));
};
