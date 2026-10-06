import {
  ClassDeclaration,
  ClassExpression,
  Node,
  PropertyAccessExpression,
  SourceFile,
  SyntaxKind,
  Type,
} from 'ts-morph';
import { outermostWrapper } from './wrappers';
import { bracketWritesOf, isDecorated, isKeyFor, isWritten, writesUnknownMembers } from './writes';

const classLikes = (file: SourceFile): readonly (ClassDeclaration | ClassExpression)[] => [
  ...file.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ...file.getDescendantsOfKind(SyntaxKind.ClassExpression),
];

const isOpenKeyType = (type: Type): boolean =>
  (type.isString() && !type.isStringLiteral()) ||
  type.isTemplateLiteral() ||
  type.isAny() ||
  type.isUnknown() ||
  type.getUnionTypes().some(isOpenKeyType);

const computedKeyOf = (member: Node): Node | undefined => {
  const nameNode = Node.isPropertyNamed(member) ? member.getNameNode() : undefined;
  return Node.isComputedPropertyName(nameNode) ? nameNode.getExpression() : undefined;
};

const hasComputedKeyFor = (member: Node, name: string): boolean => {
  const key = computedKeyOf(member);
  return key !== undefined && (isKeyFor(key, name) || isOpenKeyType(key.getType()));
};

const isNamed = (member: Node, name: string): boolean =>
  member.getSymbol()?.getName() === name ||
  (Node.hasName(member) && member.getName() === name) ||
  hasComputedKeyFor(member, name);

const isNonMethodMemberNamed =
  (name: string) =>
  (member: Node): boolean =>
    !Node.isMethodDeclaration(member) && isNamed(member, name);

const declaresNonMethodMember = (name: string, files: readonly SourceFile[]): boolean =>
  files.some((file) => classLikes(file).some((classLike) => classLike.getInstanceMembers().some(isNonMethodMemberNamed(name))));

const isWrittenAccessNamed =
  (name: string) =>
  (access: PropertyAccessExpression): boolean =>
    access.getName() === name && isWritten(outermostWrapper(access));

const isWrittenByName = (name: string, files: readonly SourceFile[]): boolean =>
  files.some((file) => file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(isWrittenAccessNamed(name)));

const isAssertable = (name: string, files: readonly SourceFile[]): boolean =>
  !declaresNonMethodMember(name, files) && !isWrittenByName(name, files) && bracketWritesOf(name, files).length === 0;

const classExpressionsIn = (files: readonly SourceFile[]): readonly ClassExpression[] =>
  files.flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassExpression));

const installsUnknownMembers = (classes: readonly (ClassDeclaration | ClassExpression)[]): boolean =>
  classes.some(isDecorated) || classes.some(writesUnknownMembers);

export const assertedInertEventMethods = (
  names: readonly string[],
  family: readonly ClassDeclaration[],
  files: readonly SourceFile[],
): ReadonlySet<string> =>
  names.length === 0 || installsUnknownMembers([...family, ...classExpressionsIn(files)])
    ? new Set()
    : new Set(names.filter((name) => isAssertable(name, files)));

const hasResolvedBase = (cls: ClassDeclaration): boolean => {
  const heritage = cls.getExtends();
  return heritage === undefined || !heritage.getType().isAny();
};

export const hasResolvedBases = (chain: readonly ClassDeclaration[]): boolean => chain.every(hasResolvedBase);

export const isDeclaredOnlyAsMethods = (declarations: readonly Node[]): boolean =>
  declarations.length > 0 &&
  declarations.every((declaration) => Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration));
