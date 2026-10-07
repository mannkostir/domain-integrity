import { ClassDeclaration, SourceFile } from 'ts-morph';
import { ClassIdentity } from '../../../engine/class-identity';
import { isPlainEventArray } from '../../shared/array-store';
import { isLibraryNode } from '../../shared/library';
import { hierarchyOf } from '../hierarchy';
import { ProjectClasses } from '../keys';
import { UndispatchedBuffer } from '../model';
import { isTestFile } from '../test-files';
import { BufferCandidate } from './buffer-candidate';
import { candidatesIn, declaringClassOf } from './candidates';
import { isUndrained } from './drains';
import { hasEscapeRoute } from './escapes';
import { familyHolding } from './family-type';
import { raisingClasses } from './raisers';

export type BufferContext = {
  readonly files: readonly SourceFile[];
  readonly root: string;
  readonly configFile?: SourceFile;
  readonly eventMethods: readonly string[];
  readonly isProject: ProjectClasses;
  readonly identity: (cls: ClassDeclaration) => ClassIdentity;
};

type Scope = {
  readonly projectFiles: readonly SourceFile[];
  readonly production: readonly SourceFile[];
};

const isScannedFile = (file: SourceFile, context: BufferContext): boolean => file !== context.configFile && !isLibraryNode(file);

const scopeOf = (context: BufferContext): Scope => {
  const projectFiles = (context.files[0]?.getProject().getSourceFiles() ?? []).filter((file) => isScannedFile(file, context));
  return { projectFiles, production: projectFiles.filter((file) => !isTestFile(file, context.root)) };
};

const isCandidateOpen = (candidate: BufferCandidate, owner: ClassDeclaration, context: BufferContext, scope: Scope): boolean =>
  isPlainEventArray(candidate.buffer, candidate.family, scope.projectFiles) && !hierarchyOf(owner, context.isProject).extendsForeign;

const firstPusherName = (candidate: BufferCandidate): string =>
  candidate.pushers.map((pusher) => pusher.getName()).sort()[0] ?? '';

const bufferOf = (candidate: BufferCandidate, owner: ClassDeclaration, raisers: readonly string[], context: BufferContext): UndispatchedBuffer => {
  const { id, name } = context.identity(owner);
  const { buffer } = candidate;
  return {
    ownerId: id,
    owner: name,
    buffer: buffer.getName(),
    method: firstPusherName(candidate),
    raisers,
    file: buffer.getSourceFile().getFilePath(),
    line: buffer.getStartLineNumber(),
  };
};

const raiserIds = (candidate: BufferCandidate, context: BufferContext, scope: Scope): readonly string[] =>
  [...new Set(raisingClasses(candidate, scope.production, context.isProject).map((cls) => context.identity(cls).id))].sort();

const undispatched = (candidate: BufferCandidate, context: BufferContext, scope: Scope): UndispatchedBuffer | undefined => {
  const owner = declaringClassOf(candidate.buffer);
  if (owner === undefined || !context.isProject(owner) || !isCandidateOpen(candidate, owner, context, scope)) return undefined;
  if (!isUndrained(candidate, scope.production)) return undefined;
  const raisers = raiserIds(candidate, context, scope);
  const reported = raisers.length > 0 && !hasEscapeRoute(scope.production, familyHolding(candidate.family));
  return reported ? bufferOf(candidate, owner, raisers, context) : undefined;
};

const byLocation = (left: UndispatchedBuffer, right: UndispatchedBuffer): number =>
  left.file.localeCompare(right.file) || left.line - right.line;

export const undispatchedBuffers = (context: BufferContext): readonly UndispatchedBuffer[] => {
  if (context.eventMethods.length === 0) return [];
  const scope = scopeOf(context);
  return candidatesIn(context.files, context.eventMethods, context.isProject, scope.projectFiles)
    .flatMap((candidate) => undispatched(candidate, context, scope) ?? [])
    .sort(byLocation);
};
