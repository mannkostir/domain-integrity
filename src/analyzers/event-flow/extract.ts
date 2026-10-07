import { ClassDeclaration, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { AnalysisInput } from '../../analyzer';
import { ClassIdentity, classIdentities } from '../../engine/class-identity';
import { undispatchedBuffers } from './buffers/discover';
import { hierarchyOf } from './hierarchy';
import { ProjectClasses } from './keys';
import { ClassRef, EventClassModel, EventFlowModel, Location, Payload, Registration, SagaModel, UnresolvedSite } from './model';
import { referenceFacts } from './references';
import { decoratorRecogniser } from './registrations/decorator';
import { RawRegistration, RecognisedSite, RecogniserContext, enclosingClass } from './registrations/recogniser';
import { registerCallRecogniser } from './registrations/register-call';
import { sagaStreamRecogniser } from './registrations/saga-stream';
import { subscribedToRecogniser } from './registrations/subscribed-to';
import { isTestFile } from './test-files';

const RECOGNISERS = [decoratorRecogniser, registerCallRecogniser, subscribedToRecogniser, sagaStreamRecogniser];

const locationOf = (node: Node): Location => ({ file: node.getSourceFile().getFilePath(), line: node.getStartLineNumber() });

const unique = <T>(items: readonly T[]): readonly T[] => [...new Set(items)];

export const extractEventFlows = (input: AnalysisInput): EventFlowModel => {
  const analysed: ReadonlySet<SourceFile> = new Set(input.files);
  const isProject: ProjectClasses = (cls) => analysed.has(cls.getSourceFile());
  const identities = classIdentities(input.files.flatMap((file) => file.getDescendantsOfKind(SyntaxKind.ClassDeclaration)), input.root);
  const identity = (cls: ClassDeclaration): ClassIdentity => {
    const found = identities.get(cls);
    if (found === undefined) throw new Error(`${cls.getName() ?? 'anonymous class'} is not in the analysed files`);
    return found;
  };
  const context: RecogniserContext = { events: input.declaration.events, isProject };
  const sites: readonly RecognisedSite[] = RECOGNISERS.flatMap((recogniser) => input.files.flatMap((file) => recogniser.sites(file, context)));
  const raw: readonly RawRegistration[] = sites.flatMap((site) => (site.kind === 'resolved' ? site.registrations : []));
  const declared = input.declaration.events;
  const outside = [...declared.inProcess, ...declared.sagas.flatMap((saga) => [saga.target, ...saga.outcomes.flat()])].filter((cls) => !isProject(cls));
  const inProcess = declared.inProcess.filter(isProject);
  const sagas = declared.sagas.filter((saga) => [saga.target, ...saga.outcomes.flat()].every(isProject));
  const eventClasses = unique([...raw.map((registration) => registration.event), ...inProcess, ...sagas.flatMap((saga) => saga.outcomes.flat())]);
  const keys: ReadonlySet<Node> = new Set(raw.map((registration) => registration.key));
  const isTest = (file: SourceFile): boolean => isTestFile(file, input.root);
  const referenceContext = { analysed, isTest, keys };
  const hierarchies = new Map([...eventClasses, ...sagas.map((saga) => saga.target)].map((cls) => [cls, hierarchyOf(cls, isProject)]));
  const ancestorIds = (cls: ClassDeclaration): readonly string[] => (hierarchies.get(cls)?.ancestors ?? []).map((ancestor) => identity(ancestor).id);

  const payloadOf = (registration: RawRegistration): Payload =>
    registration.payload.kind === 'classes'
      ? { kind: 'classes', classes: registration.payload.classes.map((cls) => identity(cls).id), ...locationOf(registration.payload.node) }
      : { kind: 'unreadable' };

  const registrations: readonly Registration[] = raw.map((registration) => ({
    event: identity(registration.event).id,
    handlerClass: registration.handler === undefined ? undefined : identity(registration.handler).id,
    handlerMethod: registration.method,
    payload: payloadOf(registration),
    inTest: isTest(registration.node.getSourceFile()),
    ...locationOf(registration.node),
  }));

  const ownerOf = (node: Node): string | undefined => {
    const owner = enclosingClass(node);
    return owner === undefined ? undefined : identity(owner).id;
  };

  const unresolved: readonly UnresolvedSite[] = sites.flatMap((site) =>
    site.kind === 'resolved' ? [] : [{ owner: ownerOf(site.node), ...locationOf(site.node) }],
  );

  const libraryKeyed: readonly (string | undefined)[] = sites.flatMap((site) => (site.kind === 'resolved' && site.libraryKeyed ? [ownerOf(site.node)] : []));

  const events = new Map<string, EventClassModel>(
    eventClasses.map((cls) => {
      const id = identity(cls).id;
      const hierarchy = hierarchies.get(cls);
      const opaque = hierarchy?.opaque ?? false;
      const extendsLibrary = (hierarchy?.extendsForeign ?? false) && !opaque;
      return [id, { id, abstract: cls.isAbstract(), ancestors: ancestorIds(cls), ...referenceFacts(cls, referenceContext), opaque, extendsLibrary }];
    }),
  );

  const sagaModels: readonly SagaModel[] = sagas.map((saga) => ({
    id: identity(saga.target).id,
    ancestors: ancestorIds(saga.target),
    extendsForeign: hierarchies.get(saga.target)?.extendsForeign ?? false,
    outcomes: saga.outcomes.map(([success, failure]) => [identity(success).id, identity(failure).id] as const),
  }));

  const referenced = unique([
    ...eventClasses,
    ...raw.flatMap((registration) => [
      ...(registration.handler === undefined ? [] : [registration.handler]),
      ...(registration.payload.kind === 'classes' ? registration.payload.classes : []),
    ]),
    ...sagas.map((saga) => saga.target),
    ...[...hierarchies.values()].flatMap((hierarchy) => hierarchy.ancestors),
  ]);

  const classes = new Map<string, ClassRef>(
    referenced.map((cls) => {
      const { id, name, qualifiedName } = identity(cls);
      return [id, { id, name, qualifiedName, ...locationOf(cls) }];
    }),
  );

  return {
    classes,
    events,
    registrations,
    unresolved,
    libraryKeyed,
    inProcess: inProcess.map((cls) => identity(cls).id),
    sagas: sagaModels,
    buffers: undispatchedBuffers({ files: input.files, root: input.root, eventMethods: input.declaration.eventMethods, isProject, identity }),
    problems: unique(outside).map((cls) => `"${cls.getName() ?? 'anonymous class'}" is declared in events but is not in the analysed files.`),
  };
};
