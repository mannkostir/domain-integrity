import { ClassDeclaration, MethodDeclaration, Node, SourceFile } from 'ts-morph';
import { outermostWrapper } from './wrappers';
import { accessOf, bracketWritesOf, isDecorated, isWritten, writesUnknownMembers } from './writes';

const familyMembersNamed = (family: readonly ClassDeclaration[], name: string): readonly Node[] =>
  family.flatMap((cls) => cls.getInstanceMembers().filter((member) => member.getName() === name));

const isWrittenReference = (reference: Node): boolean => {
  const access = accessOf(reference);
  return access !== undefined && isWritten(outermostWrapper(access));
};

const isNeverRewritten = (method: MethodDeclaration): boolean => !method.findReferencesAsNodes().some(isWrittenReference);

const isAssertable = (name: string, family: readonly ClassDeclaration[], files: readonly SourceFile[]): boolean => {
  const members = familyMembersNamed(family, name);
  const methods = members.filter(Node.isMethodDeclaration);
  return methods.length === members.length && methods.every(isNeverRewritten) && bracketWritesOf(name, files).length === 0;
};

const installsUnknownMembers = (family: readonly ClassDeclaration[]): boolean =>
  family.some(isDecorated) || family.some(writesUnknownMembers);

export const assertedInertEventMethods = (
  names: readonly string[],
  family: readonly ClassDeclaration[],
  files: readonly SourceFile[],
): ReadonlySet<string> =>
  installsUnknownMembers(family) ? new Set() : new Set(names.filter((name) => isAssertable(name, family, files)));

export const isDeclaredOnlyAsMethods = (declarations: readonly Node[]): boolean =>
  declarations.length > 0 &&
  declarations.every((declaration) => Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration));
