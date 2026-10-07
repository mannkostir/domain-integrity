import { ClassDeclaration, MethodDeclaration, Node, PropertyDeclaration, SourceFile, SyntaxKind } from 'ts-morph';
import { isPushOnlyMethod, plainEventArrays } from '../../shared/array-store';
import { hierarchyOf } from '../hierarchy';
import { ProjectClasses } from '../keys';
import { BufferCandidate } from './buffer-candidate';
import { hasHeirOutside, ProjectClass, projectClassesIn } from './outside-heirs';

type Push = { readonly buffer: PropertyDeclaration; readonly pusher: MethodDeclaration };

type Family = {
  readonly members: readonly ClassDeclaration[];
  readonly holders: readonly ClassDeclaration[];
  readonly arrays: ReadonlySet<Node>;
};

type FamilyLookup = (owner: ClassDeclaration) => Family;

export const declaringClassOf = (buffer: PropertyDeclaration): ClassDeclaration | undefined => {
  const owner = buffer.getParent();
  return Node.isClassDeclaration(owner) ? owner : undefined;
};

const holdersOf = (cls: ClassDeclaration, projectFiles: ReadonlySet<SourceFile>): readonly ClassDeclaration[] => [
  cls,
  ...cls.getDerivedClasses().filter((derived) => projectFiles.has(derived.getSourceFile())),
];

const familyLookup = (isProject: ProjectClasses, projectFiles: readonly SourceFile[]): FamilyLookup => {
  const known = new Map<ClassDeclaration, Family>();
  const projectFileSet: ReadonlySet<SourceFile> = new Set(projectFiles);
  return (owner) => {
    const cached = known.get(owner);
    if (cached !== undefined) return cached;
    const holders = holdersOf(owner, projectFileSet);
    const members = [...hierarchyOf(owner, isProject).ancestors, ...holders];
    const family = { members, holders, arrays: plainEventArrays(members, projectFiles) };
    known.set(owner, family);
    return family;
  };
};

const pushedBuffers = (method: MethodDeclaration): readonly PropertyDeclaration[] =>
  method
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter((access) => access.getName() === 'push')
    .flatMap((access) => access.getExpression().getSymbol()?.getDeclarations() ?? [])
    .filter(Node.isPropertyDeclaration);

const isEventMethod = (method: MethodDeclaration, eventMethods: readonly string[]): boolean =>
  !method.isStatic() && method.getBody() !== undefined && eventMethods.includes(method.getName());

const pushesOf = (method: MethodDeclaration, isProject: ProjectClasses, families: FamilyLookup): readonly Push[] =>
  [...new Set(pushedBuffers(method))].flatMap((buffer) => {
    const owner = declaringClassOf(buffer);
    return owner !== undefined && isProject(owner) && isPushOnlyMethod(method, families(owner).arrays)
      ? [{ buffer, pusher: method }]
      : [];
  });

const pushesOnlyOnto = (pusher: MethodDeclaration, buffer: PropertyDeclaration): boolean =>
  pushedBuffers(pusher).every((pushed) => pushed === buffer);

const hasSingleTarget = (candidate: BufferCandidate): boolean =>
  candidate.pushers.every((pusher) => pushesOnlyOnto(pusher, candidate.buffer));

const isOtherNamesake = (member: Node, names: ReadonlySet<string>, candidate: BufferCandidate): boolean =>
  names.has(member.getSymbol()?.getName() ?? '') && !candidate.pushers.some((pusher) => pusher === member);

const hasOnlyPushingNamesakes = (candidate: BufferCandidate): boolean => {
  const names: ReadonlySet<string> = new Set(candidate.pushers.map((pusher) => pusher.getName()));
  return !candidate.family
    .flatMap((member) => member.getInstanceMembers())
    .some((member) => isOtherNamesake(member, names, candidate));
};

const toCandidate = (buffer: PropertyDeclaration, pushes: readonly Push[], families: FamilyLookup): BufferCandidate | undefined => {
  const owner = declaringClassOf(buffer);
  if (owner === undefined) return undefined;
  const family = families(owner);
  return {
    buffer,
    pushers: pushes.filter((push) => push.buffer === buffer).map((push) => push.pusher),
    family: family.members,
    arrays: family.arrays,
  };
};

const isHeldOutsideFamily = (buffer: PropertyDeclaration, families: FamilyLookup, classes: readonly ProjectClass[]): boolean => {
  const owner = declaringClassOf(buffer);
  return owner === undefined || hasHeirOutside(families(owner).holders, classes);
};

export const candidatesIn = (
  files: readonly SourceFile[],
  eventMethods: readonly string[],
  isProject: ProjectClasses,
  projectFiles: readonly SourceFile[],
): readonly BufferCandidate[] => {
  const families = familyLookup(isProject, projectFiles);
  const classes = projectClassesIn(projectFiles);
  const pushes = files
    .flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration))
    .flatMap((cls) => cls.getMethods())
    .filter((method) => isEventMethod(method, eventMethods))
    .flatMap((method) => pushesOf(method, isProject, families));
  return [...new Set(pushes.map((push) => push.buffer))]
    .filter((buffer) => !isHeldOutsideFamily(buffer, families, classes))
    .flatMap((buffer) => toCandidate(buffer, pushes, families) ?? [])
    .filter(hasSingleTarget)
    .filter(hasOnlyPushingNamesakes);
};
