import { ClassDeclaration, Node, SyntaxKind } from 'ts-morph';
import { SourceIndex } from '../../shared/source-index';
import { isLibraryNode } from '../../shared/library';
import { isWritten } from '../../shared/writes';
import { outermostWrapper } from '../../shared/wrappers';
import { referencedClass, refersTo } from './identity';
import { MAX_PROJECTION_DEPTH } from './model';

const typePosition = (node: Node): boolean => node.getAncestors().some(ancestor =>
  Node.isTypeNode(ancestor) || Node.isImportDeclaration(ancestor) || Node.isExportDeclaration(ancestor));

const unmodifiedConstructor = (cls: ClassDeclaration, sources: SourceIndex): boolean =>
  sources.ofKind(SyntaxKind.Identifier).filter(node => refersTo(node, cls) && !typePosition(node) && cls.getNameNode() !== node).every(node => {
    if (isWritten(outermostWrapper(node))) return false;
    const parent = node.getParent();
    return (Node.isNewExpression(parent) && parent.getExpression() === node) || Node.isExpressionWithTypeArguments(parent);
  });

export const freshClassInstance = (candidate: ClassDeclaration, sources: SourceIndex): boolean => {
  let cls: ClassDeclaration | undefined = candidate;
  const visited = new Set<ClassDeclaration>();
  while (cls !== undefined && visited.size < MAX_PROJECTION_DEPTH && !visited.has(cls)) {
    visited.add(cls);
    if (isLibraryNode(cls) || cls.isAmbient() || cls.getDecorators().length > 0 || !unmodifiedConstructor(cls, sources) ||
        cls.getMembers().some(member => Node.isClassStaticBlockDeclaration(member) ||
          ('getDecorators' in member && member.getDecorators().length > 0) ||
          ('getParameters' in member && member.getParameters().some(parameter => parameter.getDecorators().length > 0)))) return false;
    if (cls.getConstructors().some(constructor => constructor.getOverloads().length > 0 || constructor.getBody() === undefined ||
        constructor.getDescendantsOfKind(SyntaxKind.ReturnStatement).some(returned => returned.getFirstAncestor(Node.isFunctionLikeDeclaration) === constructor))) return false;
    const heritage = cls.getExtends();
    if (heritage === undefined) return true;
    cls = referencedClass(heritage.getExpression());
    if (cls === undefined) return false;
  }
  return false;
};


export const freshProjectConstruction = (expression: Node, sources: SourceIndex): boolean => {
  if (!Node.isNewExpression(expression)) return false;
  const cls = referencedClass(expression.getExpression());
  return cls !== undefined && freshClassInstance(cls, sources);
};
