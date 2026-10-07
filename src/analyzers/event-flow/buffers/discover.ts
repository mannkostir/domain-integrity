import { ClassDeclaration, SourceFile } from 'ts-morph';
import { ClassIdentity } from '../../../engine/class-identity';
import { isPlainEventArray } from '../../shared/array-store';
import { isLibraryNode } from '../../shared/library';
import { hierarchyOf } from '../hierarchy';
import { ProjectClasses } from '../keys';
import { UndispatchedBuffer } from '../model';
import { isTestFile } from '../test-files';
import { candidatesIn, ownerOf } from './candidates';
import { BufferCandidate, isUndrained } from './drains';
import { hasEscapeRoute } from './escapes';
import { mayHoldFamily } from './family-type';
import { raisingClasses } from './raisers';

export type BufferContext = {
  readonly files: readonly SourceFile[];
  readonly root: string;
  readonly eventMethods: readonly string[];
  readonly isProject: ProjectClasses;
  readonly identity: (cls: ClassDeclaration) => ClassIdentity;
};

type Scope = {
  readonly projectFiles: readonly SourceFile[];
  readonly production: readonly SourceFile[];
};

const scopeOf = (context: BufferContext): Scope => {
  const projectFiles = (context.files[0]?.getProject().getSourceFiles() ?? []).filter((file) => !isLibraryNode(file));
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
  const owner = ownerOf(candidate.buffer);
  if (owner === undefined || !context.isProject(owner) || !isCandidateOpen(candidate, owner, context, scope)) return undefined;
  const raisers = raiserIds(candidate, context, scope);
  const reported =
    raisers.length > 0 &&
    isUndrained(candidate, scope.production) &&
    !hasEscapeRoute(scope.production, mayHoldFamily(candidate.family));
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
