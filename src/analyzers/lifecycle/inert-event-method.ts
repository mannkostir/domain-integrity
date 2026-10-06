import { ClassDeclaration, Node, PropertyAccessExpression, SourceFile, SyntaxKind } from 'ts-morph';
import { outermostWrapper } from './wrappers';
import { bracketWritesOf, isDecorated, isWritten, writesUnknownMembers } from './writes';

const classLikes = (file: SourceFile): readonly Node[] => [
  ...file.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
  ...file.getDescendantsOfKind(SyntaxKind.ClassExpression),
];

const instanceMembersOf = (classLike: Node): readonly Node[] =>
  Node.isClassDeclaration(classLike) || Node.isClassExpression(classLike) ? classLike.getInstanceMembers() : [];

const isNamed = (member: Node, name: string): boolean =>
  member.getSymbol()?.getName() === name || (Node.hasName(member) && member.getName() === name);

const isNonMethodMemberNamed =
  (name: string) =>
  (member: Node): boolean =>
    !Node.isMethodDeclaration(member) && isNamed(member, name);

const declaresNonMethodMember = (name: string, files: readonly SourceFile[]): boolean =>
  files.some((file) => classLikes(file).some((classLike) => instanceMembersOf(classLike).some(isNonMethodMemberNamed(name))));

const isWrittenAccessNamed =
  (name: string) =>
  (access: PropertyAccessExpression): boolean =>
    access.getName() === name && isWritten(outermostWrapper(access));

const isWrittenByName = (name: string, files: readonly SourceFile[]): boolean =>
  files.some((file) => file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(isWrittenAccessNamed(name)));

const isAssertable = (name: string, files: readonly SourceFile[]): boolean =>
  !declaresNonMethodMember(name, files) && !isWrittenByName(name, files) && bracketWritesOf(name, files).length === 0;

const installsUnknownMembers = (family: readonly ClassDeclaration[]): boolean =>
  family.some(isDecorated) || family.some(writesUnknownMembers);

export const assertedInertEventMethods = (
  names: readonly string[],
  family: readonly ClassDeclaration[],
  files: readonly SourceFile[],
): ReadonlySet<string> =>
  names.length === 0 || installsUnknownMembers(family)
    ? new Set()
    : new Set(names.filter((name) => isAssertable(name, files)));

export const isDeclaredOnlyAsMethods = (declarations: readonly Node[]): boolean =>
  declarations.length > 0 &&
  declarations.every((declaration) => Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration));
