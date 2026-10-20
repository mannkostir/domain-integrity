import { ClassDeclaration, MethodDeclaration, Node, Scope } from 'ts-morph';
import { AnalysisInput } from '../../analyzer';
import { Problem } from '../../finding';
import { DeclaredField, DeclaredLifecycle, DomainDeclaration } from '../../engine/declaration';
import { ClassIdentity, classIdentities } from '../../engine/class-identity';
import { setsOf } from './assigned';
import { candidateFields } from './candidates';
import { aggregateName, discoverAggregates } from './discover';
import { AggregateScope } from './field-ref';
import { hasCyclicInheritance } from '../shared/cyclic-heritage';
import { methodSources } from './guards';
import { initialValues } from './initial';
import { transitionMethodMissing, unknownStateValue } from './problems';
import { AggregateModel, FieldDeclaration, LifecycleModel, MethodModel, StateField, Visibility } from './model';
import { instanceMethods } from './members';
import { mutatingMethods } from './mutation';
import { mentionedTokens } from './mentions';
import { outsideAssignments } from './outside';
import { ProjectIndex, projectIndex } from './project-index';
import { aggregateScope } from './scope';
import { resolveStateField } from './state-field';
import { fieldsWrittenUncertainly } from './uncertain-writes';
import { writtenAlongside } from './written-alongside';

type DeclaredOutcome =
  | { readonly kind: 'ok'; readonly field: StateField; readonly declaration: FieldDeclaration }
  | { readonly kind: 'problems'; readonly problems: readonly Problem[] };

type ResolvedFields = {
  readonly fields: readonly StateField[];
  readonly declarations: ReadonlyMap<string, FieldDeclaration>;
  readonly problems: readonly Problem[];
};

const resolveDeclaredField = (
  cls: ClassDeclaration,
  declared: DeclaredField,
  methodNames: ReadonlySet<string>,
): DeclaredOutcome => {
  const resolution = resolveStateField(cls, declared.name);
  if (resolution.kind === 'problem') return { kind: 'problems', problems: [resolution.problem] };
  const known = resolution.field.values.map((value) => value.token);
  const transitions = [...(declared.transitions ?? new Map<string, readonly string[]>())];
  const problems = [
    ...[...declared.terminal, ...transitions.flatMap(([, sources]) => sources)]
      .filter((token) => !known.includes(token))
      .map((token) => unknownStateValue(aggregateName(cls), declared.name, token, known)),
    ...transitions
      .map(([method]) => method)
      .filter((method) => !methodNames.has(method))
      .map((method) => transitionMethodMissing(aggregateName(cls), method)),
  ];
  if (problems.length > 0) return { kind: 'problems', problems };
  return {
    kind: 'ok',
    field: resolution.field,
    declaration: {
      terminal: new Set(declared.terminal),
      allowAfterTerminal: new Set(declared.allowAfterTerminal),
      transitions: declared.transitions && new Map(transitions.map(([method, sources]) => [method, new Set(sources)])),
    },
  };
};

const resolveDeclared = (
  cls: ClassDeclaration,
  declared: DeclaredLifecycle,
  methods: readonly MethodDeclaration[],
): ResolvedFields => {
  const methodNames = new Set(methods.map((method) => method.getName()));
  const outcomes = declared.fields.map((field) => resolveDeclaredField(cls, field, methodNames));
  const ok = outcomes.flatMap((outcome) => (outcome.kind === 'ok' ? [outcome] : []));
  return {
    fields: ok.map((outcome) => outcome.field),
    declarations: new Map(ok.map((outcome) => [outcome.field.name, outcome.declaration])),
    problems: outcomes.flatMap((outcome) => (outcome.kind === 'problems' ? outcome.problems : [])),
  };
};

const unknownFields: ResolvedFields = { fields: [], declarations: new Map(), problems: [] };

const resolveFields = (
  cls: ClassDeclaration,
  declared: DeclaredLifecycle | undefined,
  methods: readonly MethodDeclaration[],
  scope: AggregateScope,
  auditFields: readonly string[],
): ResolvedFields => {
  if (hasCyclicInheritance(cls)) return unknownFields;
  return declared
    ? resolveDeclared(cls, declared, methods)
    : { fields: candidateFields(scope, auditFields), declarations: new Map(), problems: [] };
};

const visibilityOf = (method: MethodDeclaration): Visibility => {
  if (Node.isPrivateIdentifier(method.getNameNode())) return 'private';
  const scope = method.getScope();
  if (scope === Scope.Private) return 'private';
  return scope === Scope.Protected ? 'protected' : 'public';
};

const methodModels = (
  scope: AggregateScope,
  methods: readonly MethodDeclaration[],
  fields: readonly StateField[],
  declared: boolean,
): MethodModel[] => {
  const mutating = mutatingMethods(methods, [...scope.eventMethods]);
  return methods.map((method) => ({
    name: method.getName(),
    file: method.getSourceFile().getFilePath(),
    line: method.getStartLineNumber(),
    visibility: visibilityOf(method),
    mutates: mutating.has(method.getName()),
    fields: new Map(
      fields.map((field) => [field.name, { sources: methodSources(method, field, scope), sets: setsOf(method, field) }]),
    ),
    writtenAlongside: declared ? new Map() : writtenAlongside(method, fields),
  }));
};

const identityOf = (identities: ReadonlyMap<ClassDeclaration, ClassIdentity>, cls: ClassDeclaration): ClassIdentity => {
  const identity = identities.get(cls);
  if (!identity) throw new Error(`no identity computed for ${aggregateName(cls)}`);
  return identity;
};

const extractAggregate = (
  cls: ClassDeclaration,
  identity: ClassIdentity,
  declaration: DomainDeclaration,
  project: ProjectIndex,
  root: string,
): { readonly aggregate: AggregateModel; readonly problems: readonly Problem[] } => {
  const declared = declaration.lifecycles.find((lifecycle) => lifecycle.target === cls);
  const methods = instanceMethods(cls, declaration.aggregateBaseClasses);
  const scope = aggregateScope(cls, declaration, project);
  const resolved = resolveFields(cls, declared, methods, scope, declaration.auditFields);
  return {
    problems: resolved.problems,
    aggregate: {
      id: identity.id,
      qualifiedName: identity.qualifiedName,
      name: aggregateName(cls),
      file: cls.getSourceFile().getFilePath(),
      line: cls.getStartLineNumber(),
      declared: declared !== undefined,
      fields: resolved.fields,
      declarations: resolved.declarations,
      allowAfterTerminal: new Set(declared?.allowAfterTerminal ?? []),
      methods: methodModels(scope, methods, resolved.fields, declared !== undefined),
      initial: new Map(resolved.fields.map((field) => [field.name, initialValues(cls, field)])),
      mentioned: new Map(declared ? resolved.fields.map((field) => [field.name, mentionedTokens(project, field)]) : []),
      outside: declared ? resolved.fields.flatMap((field) => outsideAssignments(project.sources, cls, field, root)) : [],
      uncertainlyWritten: declared
        ? new Set()
        : fieldsWrittenUncertainly(cls, declaration.aggregateBaseClasses, project.sources, resolved.fields, root),
    },
  };
};

export const extractLifecycles = ({ declaration, files, root }: AnalysisInput): LifecycleModel => {
  const project = projectIndex(files);
  const classes = discoverAggregates(
    project.sources,
    declaration.aggregateBaseClasses,
    declaration.lifecycles.map((lifecycle) => lifecycle.target),
  );
  const identities = classIdentities(classes, root);
  const extracted = classes.map((cls) => extractAggregate(cls, identityOf(identities, cls), declaration, project, root));
  return {
    aggregates: extracted.map((result) => result.aggregate),
    problems: extracted.flatMap((result) => result.problems),
    reportTestFileMutations: declaration.reportTestFileMutations,
  };
};
