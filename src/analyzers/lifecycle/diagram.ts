import { DiagramOutcome } from '../../analyzer';
import { leakedTerminalTokens } from './checks/terminal-state-leak';
import { AggregateModel, FieldDeclaration, LifecycleModel, MethodModel, StateField } from './model';

type Edge = { readonly from: string; readonly to: string; readonly label: string; readonly leak: boolean };

const LABEL_ESCAPES: Readonly<Record<string, string>> = { '#': '#35;', '"': '#quot;', ';': '#59;' };

const escapeLabel = (label: string): string => label.replace(/[#";]/g, (character) => LABEL_ESCAPES[character] ?? character);

const stateId = (field: StateField, token: string): string =>
  `${field.name}_${field.values.findIndex((value) => value.token === token)}`;

const methodEdges = (
  aggregate: AggregateModel,
  method: MethodModel,
  field: StateField,
  declaration: FieldDeclaration | undefined,
): Edge[] => {
  const behaviour = method.fields.get(field.name);
  if (!behaviour || behaviour.sources.kind === 'unknown') return [];
  const terminal = declaration?.terminal ?? new Set<string>();
  const declared = declaration?.transitions?.get(method.name);
  const leaks = leakedTerminalTokens(aggregate, method, field, terminal);
  const targets = [...behaviour.sets.tokens];
  const moves = [...behaviour.sources.values].flatMap((from) =>
    targets
      .filter((to) => to !== from)
      .map((to) => ({
        from,
        to,
        label: `${method.name}${declared && !declared.has(from) ? ' ⚠ undeclared' : ''}${leaks.includes(from) ? ' ⚠ leak' : ''}`,
        leak: leaks.includes(from),
      })),
  );
  const selfLeaks = leaks
    .filter((token) => !targets.some((to) => to !== token))
    .map((token) => ({ from: token, to: token, label: `${method.name} ⚠ leak`, leak: true }));
  return [...moves, ...selfLeaks];
};

const unanalysed = (aggregate: AggregateModel, field: StateField): string[] => {
  const names = aggregate.methods
    .filter((method) => method.mutates && method.fields.get(field.name)?.sources.kind === 'unknown')
    .map((method) => method.name);
  const [first] = field.values;
  return names.length === 0 || first === undefined
    ? []
    : [`  note right of ${stateId(field, first.token)} : guard not analysed: ${escapeLabel(names.join(', '))}`];
};

export const fieldDiagram = (aggregate: AggregateModel, field: StateField): string => {
  const declaration = aggregate.declarations.get(field.name);
  const terminal = [...(declaration?.terminal ?? new Set<string>())];
  const edges = aggregate.methods.flatMap((method) => methodEdges(aggregate, method, field, declaration));
  const leaked = new Set(edges.filter((edge) => edge.leak).map((edge) => edge.from));
  return [
    'stateDiagram-v2',
    ...field.values.map((value) => `  state "${escapeLabel(value.label)}" as ${stateId(field, value.token)}`),
    ...[...(aggregate.initial.get(field.name)?.tokens ?? [])].map((token) => `  [*] --> ${stateId(field, token)}`),
    ...edges.map((edge) => `  ${stateId(field, edge.from)} --> ${stateId(field, edge.to)} : ${escapeLabel(edge.label)}`),
    ...terminal.map((token) => `  ${stateId(field, token)} --> [*]`),
    ...unanalysed(aggregate, field),
    '  classDef terminal font-weight:bold',
    '  classDef leak fill:#fde2e2,stroke:#c0392b',
    ...terminal.map((token) => `  class ${stateId(field, token)} ${leaked.has(token) ? 'leak' : 'terminal'}`),
  ].join('\n');
};

type Selection =
  | { readonly kind: 'selected'; readonly aggregates: readonly AggregateModel[] }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

const isNamed = (aggregate: AggregateModel, only: string): boolean =>
  aggregate.qualifiedName === only || aggregate.name === only;

const selectDeclared = (aggregates: readonly AggregateModel[], only: string | undefined): Selection => {
  const declared = aggregates.filter((aggregate) => aggregate.declared);
  if (only === undefined) return { kind: 'selected', aggregates: declared };
  const matches = declared.filter((aggregate) => isNamed(aggregate, only));
  return matches.length > 1
    ? { kind: 'ambiguous', candidates: matches.map((aggregate) => aggregate.qualifiedName) }
    : { kind: 'selected', aggregates: matches };
};

const aggregateSections = (aggregate: AggregateModel): string[] =>
  aggregate.fields
    .filter((field) => aggregate.declarations.has(field.name))
    .map((field) => `## ${aggregate.id}.${field.name}\n\n\`\`\`mermaid\n${fieldDiagram(aggregate, field)}\n\`\`\``);

export const lifecycleDiagrams = (model: LifecycleModel, only: string | undefined): DiagramOutcome => {
  const selection = selectDeclared(model.aggregates, only);
  return selection.kind === 'ambiguous'
    ? selection
    : { kind: 'diagram', text: selection.aggregates.flatMap(aggregateSections).join('\n\n') };
};
