import { ClassDeclaration, MethodDeclaration, Node, SourceFile, Type } from 'ts-morph';
import { outermostWrapper, unwrap } from './wrappers';
import { accessOf, bracketWritesOf, isDecorated, isWritten, writesUnknownMembers } from './writes';

const familyMembersNamed = (family: readonly ClassDeclaration[], name: string): readonly Node[] =>
  family.flatMap((cls) => cls.getInstanceMembers().filter((member) => member.getName() === name));

const isWrittenReference = (reference: Node): boolean => {
  const access = accessOf(reference);
  return access !== undefined && isWritten(outermostWrapper(access));
};

const isNeverRewritten = (method: MethodDeclaration): boolean => !method.findReferencesAsNodes().some(isWrittenReference);

const declaresFamilyMember = (type: Type, name: string, members: ReadonlySet<Node>): boolean =>
  (type.getProperty(name)?.getDeclarations() ?? []).some((declaration) => members.has(declaration));

const mayHoldFamilyInstance = (
  type: Type,
  name: string,
  family: readonly ClassDeclaration[],
  members: ReadonlySet<Node>,
): boolean =>
  type.isAny() ||
  type.isUnknown() ||
  type.getStringIndexType() !== undefined ||
  (type.isUnion() && type.getUnionTypes().some((member) => mayHoldFamilyInstance(member, name, family, members))) ||
  declaresFamilyMember(type, name, members) ||
  family.some((cls) => cls.getType().isAssignableTo(type));

const receiverType = (write: Node): Type | undefined => {
  const access = unwrap(write);
  return Node.isElementAccessExpression(access) ? access.getExpression().getType().getApparentType() : undefined;
};

const isFamilyBracketWrite =
  (name: string, family: readonly ClassDeclaration[], members: ReadonlySet<Node>) =>
  (write: Node): boolean => {
    const type = receiverType(write);
    return type === undefined || mayHoldFamilyInstance(type, name, family, members);
  };

const isBracketWrittenOnFamily = (
  name: string,
  family: readonly ClassDeclaration[],
  members: readonly Node[],
  files: readonly SourceFile[],
): boolean => bracketWritesOf(name, files).some(isFamilyBracketWrite(name, family, new Set(members)));

const isAssertable = (name: string, family: readonly ClassDeclaration[], files: readonly SourceFile[]): boolean => {
  const members = familyMembersNamed(family, name);
  const methods = members.filter(Node.isMethodDeclaration);
  return (
    methods.length === members.length &&
    methods.every(isNeverRewritten) &&
    !isBracketWrittenOnFamily(name, family, members, files)
  );
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
