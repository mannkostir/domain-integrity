import { AggregateModel, FieldBehaviour, LifecycleModel, MethodModel, StateField, StateValue } from './model';
import { hasUnknownWrite, writesField } from './values';

export type TransitionSeed = { readonly method: string; readonly from: readonly StateValue[] };

export type SeededTransitions =
  | { readonly kind: 'seeded'; readonly entries: readonly TransitionSeed[] }
  | { readonly kind: 'withheld'; readonly unknownMethods: readonly string[] }
  | { readonly kind: 'none' };

export type FieldSuggestion = {
  readonly field: StateField;
  readonly terminal: readonly StateValue[];
  readonly transitions: SeededTransitions;
};

export type LifecycleSuggestion = {
  readonly className: string;
  readonly file: string;
  readonly fields: readonly FieldSuggestion[];
};

const leavesFrom = (behaviour: FieldBehaviour, token: string): boolean =>
  behaviour.sources.kind === 'unknown' ||
  behaviour.sets.unresolved ||
  (behaviour.sources.values.has(token) && [...behaviour.sets.tokens].some((target) => target !== token));

const terminalGuess = (aggregate: AggregateModel, field: StateField): StateValue[] => {
  const setters = aggregate.methods
    .map((method) => method.fields.get(field.name))
    .filter((behaviour): behaviour is FieldBehaviour => behaviour !== undefined && writesField(behaviour.sets));
  return field.values.filter(
    (value) =>
      setters.some((behaviour) => behaviour.sets.tokens.has(value.token)) &&
      !setters.some((behaviour) => leavesFrom(behaviour, value.token)),
  );
};

type TerminalGuesses = ReadonlyMap<string, readonly StateValue[]>;

const tracksLifecycle = (field: StateField): boolean => field.kind === 'enum' || field.kind === 'union';

const onlyTerminal = (tokens: ReadonlySet<string>, terminal: readonly StateValue[]): boolean =>
  tokens.size > 0 && [...tokens].every((token) => terminal.some((value) => value.token === token));

const writesOnlyTerminal = (behaviour: FieldBehaviour | undefined, terminal: readonly StateValue[]): boolean =>
  behaviour !== undefined && !behaviour.sets.unresolved && !behaviour.sets.mayWrite && onlyTerminal(behaviour.sets.tokens, terminal);

const alwaysWrittenTerminal = (method: MethodModel, field: StateField, name: string, terminal: readonly StateValue[]): boolean =>
  onlyTerminal(method.writtenAlongside.get(field.name)?.get(name) ?? new Set(), terminal);

const settlesLifecycle = (method: MethodModel, field: StateField, lifecycleGuesses: TerminalGuesses): boolean =>
  [...lifecycleGuesses].some(
    ([name, terminal]) =>
      writesOnlyTerminal(method.fields.get(name), terminal) && alwaysWrittenTerminal(method, field, name, terminal),
  );

const setsAnyOf = (method: MethodModel, field: StateField, values: readonly StateValue[]): boolean =>
  values.some((value) => method.fields.get(field.name)?.sets.tokens.has(value.token) === true);

const writtenUncertainly = (aggregate: AggregateModel, field: StateField): boolean =>
  aggregate.uncertainlyWritten.has(field.name) ||
  aggregate.methods.some((method) => {
    const behaviour = method.fields.get(field.name);
    return behaviour !== undefined && hasUnknownWrite(behaviour.sets);
  });

const coveredByLifecycle = (
  aggregate: AggregateModel,
  field: StateField,
  guess: readonly StateValue[],
  lifecycleGuesses: TerminalGuesses,
): boolean =>
  field.kind === 'nullable' &&
  !writtenUncertainly(aggregate, field) &&
  aggregate.methods
    .filter((method) => setsAnyOf(method, field, guess))
    .every((method) => settlesLifecycle(method, field, lifecycleGuesses));

type Writer = { readonly name: string; readonly behaviour: FieldBehaviour };

const publicWriters = (aggregate: AggregateModel, field: StateField): Writer[] =>
  aggregate.methods
    .filter((method) => method.visibility === 'public')
    .map((method) => ({ name: method.name, behaviour: method.fields.get(field.name) }))
    .filter((writer): writer is Writer => writer.behaviour !== undefined && writesField(writer.behaviour.sets));

const sourcesUnknownFor = (field: StateField, { behaviour }: Writer): boolean =>
  behaviour.sources.kind === 'unknown' ||
  [...behaviour.sources.values].some((token) => !field.values.some((value) => value.token === token));

const seedOf = (field: StateField, { name, behaviour }: Writer): TransitionSeed => ({
  method: name,
  from: field.values.filter((value) => behaviour.sources.kind === 'known' && behaviour.sources.values.has(value.token)),
});

const seededTransitions = (aggregate: AggregateModel, field: StateField): SeededTransitions => {
  const writers = publicWriters(aggregate, field);
  if (writers.length === 0) return { kind: 'none' };
  const unknownMethods = writers.filter((writer) => sourcesUnknownFor(field, writer)).map((writer) => writer.name);
  if (unknownMethods.length > 0) return { kind: 'withheld', unknownMethods };
  return { kind: 'seeded', entries: writers.map((writer) => seedOf(field, writer)) };
};

const suggestFields = (aggregate: AggregateModel): FieldSuggestion[] => {
  const guesses = aggregate.fields.map((field) => ({ field, terminal: terminalGuess(aggregate, field) }));
  const lifecycleGuesses: TerminalGuesses = new Map(
    guesses.filter(({ field }) => tracksLifecycle(field)).map(({ field, terminal }) => [field.name, terminal]),
  );
  return guesses.map(({ field, terminal }) => ({
    field,
    terminal: coveredByLifecycle(aggregate, field, terminal, lifecycleGuesses) ? [] : terminal,
    transitions: seededTransitions(aggregate, field),
  }));
};

export const suggestLifecycles = (model: LifecycleModel): LifecycleSuggestion[] =>
  model.aggregates
    .filter((aggregate) => !aggregate.declared && aggregate.fields.length > 0)
    .map((aggregate) => ({
      className: aggregate.name,
      file: aggregate.file,
      fields: suggestFields(aggregate),
    }));
