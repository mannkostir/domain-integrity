import { AggregateModel, FieldBehaviour, LifecycleModel, MethodModel, StateField, StateValue } from './model';
import { writesField } from './values';

export type FieldSuggestion = { readonly field: StateField; readonly terminal: readonly StateValue[] };

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

const writesOnlyTerminal = (behaviour: FieldBehaviour | undefined, terminal: readonly StateValue[]): boolean =>
  behaviour !== undefined &&
  !behaviour.sets.unresolved &&
  !behaviour.sets.mayWrite &&
  behaviour.sets.tokens.size > 0 &&
  [...behaviour.sets.tokens].every((token) => terminal.some((value) => value.token === token));

const settlesLifecycle = (method: MethodModel, lifecycleGuesses: TerminalGuesses): boolean =>
  [...lifecycleGuesses].some(([name, terminal]) => writesOnlyTerminal(method.fields.get(name), terminal));

const setsAnyOf = (method: MethodModel, field: StateField, values: readonly StateValue[]): boolean =>
  values.some((value) => method.fields.get(field.name)?.sets.tokens.has(value.token) === true);

const coveredByLifecycle = (
  aggregate: AggregateModel,
  field: StateField,
  guess: readonly StateValue[],
  lifecycleGuesses: TerminalGuesses,
): boolean =>
  field.kind === 'nullable' &&
  aggregate.methods
    .filter((method) => setsAnyOf(method, field, guess))
    .every((method) => settlesLifecycle(method, lifecycleGuesses));

const suggestFields = (aggregate: AggregateModel): FieldSuggestion[] => {
  const guesses = aggregate.fields.map((field) => ({ field, terminal: terminalGuess(aggregate, field) }));
  const lifecycleGuesses: TerminalGuesses = new Map(
    guesses.filter(({ field }) => tracksLifecycle(field)).map(({ field, terminal }) => [field.name, terminal]),
  );
  return guesses.map(({ field, terminal }) => ({
    field,
    terminal: coveredByLifecycle(aggregate, field, terminal, lifecycleGuesses) ? [] : terminal,
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
