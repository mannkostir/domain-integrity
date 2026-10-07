import { ClassDeclaration, GetAccessorDeclaration, Node, PropertyAccessExpression, SourceFile, SyntaxKind } from 'ts-morph';
import { isPlainArrayPush, isResetToEmpty } from '../../shared/array-store';
import { outermostWrapper } from '../../shared/wrappers';
import { BufferCandidate } from './buffer-candidate';
import { occurrencesOf } from './occurrences';

const thisAccessNamedBy = (occurrence: Node): PropertyAccessExpression | undefined => {
  const parent = occurrence.getParent();
  return Node.isPropertyAccessExpression(parent) &&
    parent.getNameNode() === occurrence &&
    Node.isThisExpression(parent.getExpression())
    ? parent
    : undefined;
};

const isInsideFamily = (node: Node, family: readonly ClassDeclaration[]): boolean => {
  const owner = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
  return owner !== undefined && family.includes(owner);
};

const isPush = (access: PropertyAccessExpression, candidate: BufferCandidate): boolean => {
  const method = access.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  return method !== undefined && candidate.pushers.includes(method) && isPlainArrayPush(access, candidate.arrays);
};

const isReset = (access: PropertyAccessExpression, candidate: BufferCandidate): boolean =>
  isInsideFamily(access, candidate.family) && isResetToEmpty(outermostWrapper(access));

const isSoleStatementOf = (statement: Node, block: Node | undefined): boolean =>
  Node.isBlock(block) && block.getStatements().length === 1 && block.getStatements()[0] === statement;

const isUndecoratedFamilyGetter = (
  getter: Node | undefined,
  family: readonly ClassDeclaration[],
): getter is GetAccessorDeclaration =>
  Node.isGetAccessorDeclaration(getter) && getter.getDecorators().length === 0 && isInsideFamily(getter, family);

const trivialGetterOf = (access: PropertyAccessExpression, candidate: BufferCandidate): GetAccessorDeclaration | undefined => {
  const statement = outermostWrapper(access).getParent();
  if (!Node.isReturnStatement(statement)) return undefined;
  const block = statement.getParent();
  const getter = block?.getParent();
  return isSoleStatementOf(statement, block) && isUndecoratedFamilyGetter(getter, candidate.family) ? getter : undefined;
};

const isUnreadGetterBody = (
  access: PropertyAccessExpression,
  candidate: BufferCandidate,
  production: readonly SourceFile[],
): boolean => {
  const getter = trivialGetterOf(access, candidate);
  return getter !== undefined && occurrencesOf(getter, production, candidate.family)?.length === 0;
};

const isSilentUse = (occurrence: Node, candidate: BufferCandidate, production: readonly SourceFile[]): boolean => {
  const access = thisAccessNamedBy(occurrence);
  return (
    access !== undefined &&
    (isPush(access, candidate) || isReset(access, candidate) || isUnreadGetterBody(access, candidate, production))
  );
};

export const isUndrained = (candidate: BufferCandidate, production: readonly SourceFile[]): boolean =>
  occurrencesOf(candidate.buffer, production, candidate.family)?.every((occurrence) =>
    isSilentUse(occurrence, candidate, production),
  ) ?? false;
