import {
  ClassDeclaration,
  ClassExpression,
  Node,
  PropertyAccessExpression,
  SourceFile,
  SyntaxKind,
  ts,
  Type,
} from 'ts-morph';
import { outermostWrapper } from './wrappers';
import { bracketWritesOf, isDecorated, isWritten, writesUnknownMembers } from './writes';

const classLikes = (file: SourceFile): readonly (ClassDeclaration | ClassExpression)[] => [
  ...file.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ...file.getDescendantsOfKind(SyntaxKind.ClassExpression),
];

const NON_STRING_KEY_FLAGS = ts.TypeFlags.NumberLike | ts.TypeFlags.ESSymbolLike;

const isOtherLiteral = (type: Type, name: string): boolean => type.isStringLiteral() && type.getLiteralValue() !== name;

const isNonStringKey = (type: Type): boolean => (type.getFlags() & NON_STRING_KEY_FLAGS) !== 0;

const isProvablyOtherKeyType = (type: Type, name: string): boolean => {
  if (type.isUnion()) return type.getUnionTypes().every((member) => isProvablyOtherKeyType(member, name));
  if (type.isTypeParameter()) {
    const constraint = type.getConstraint();
    return constraint !== undefined && isProvablyOtherKeyType(constraint, name);
  }
  return isOtherLiteral(type, name) || isNonStringKey(type);
};

const computedKeyOf = (member: Node): Node | undefined => {
  const nameNode = Node.isPropertyNamed(member) ? member.getNameNode() : undefined;
  return Node.isComputedPropertyName(nameNode) ? nameNode.getExpression() : undefined;
};

const hasComputedKeyFor = (member: Node, name: string): boolean => {
  const key = computedKeyOf(member);
  return key !== undefined && !isProvablyOtherKeyType(key.getType(), name);
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
