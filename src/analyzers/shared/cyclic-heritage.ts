import { ClassDeclaration, Node } from 'ts-morph';
import { ancestry } from './ancestry';
import { declarationsOf } from './named-class';

const isPlainReference = (node: Node): boolean => Node.isIdentifier(node) || Node.isPropertyAccessExpression(node);

const referencedDeclarations = (reference: Node): readonly Node[] =>
  declarationsOf(Node.isPropertyAccessExpression(reference) ? reference.getNameNode() : reference);

const singleClass = (declarations: readonly Node[]): ClassDeclaration | undefined => {
  const [only, ...rest] = declarations;
  return rest.length === 0 && Node.isClassDeclaration(only) ? only : undefined;
};

const aliasedReference = (reference: Node): Node | undefined => {
  const [only, ...rest] = referencedDeclarations(reference);
  const initializer = rest.length === 0 && Node.isVariableDeclaration(only) ? only.getInitializer() : undefined;
  return initializer !== undefined && isPlainReference(initializer) ? initializer : undefined;
};

const classReferencedBy = (reference: Node): ClassDeclaration | undefined =>
  singleClass(referencedDeclarations(reference)) ?? singleClass(reference.getType().getSymbol()?.getDeclarations() ?? []);

const classBehind = (expression: Node): ClassDeclaration | undefined => {
  if (!isPlainReference(expression)) return undefined;
  const { chain, cyclic } = ancestry(expression, aliasedReference);
  const target = chain.at(-1);
  return cyclic || target === undefined ? undefined : classReferencedBy(target);
};

const baseClassOf = (cls: ClassDeclaration): ClassDeclaration | undefined => cls.getBaseClass();

const namedBaseOf = (cls: ClassDeclaration): ClassDeclaration | undefined => {
  const heritage = cls.getExtends();
  return heritage === undefined ? undefined : classBehind(heritage.getExpression());
};

export const hasCyclicInheritance = (cls: ClassDeclaration): boolean =>
  ancestry(cls, baseClassOf).cyclic || ancestry(cls, namedBaseOf).cyclic;
