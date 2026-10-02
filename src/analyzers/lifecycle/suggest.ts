import { AggregateModel, FieldBehaviour, LifecycleModel, StateField, StateValue } from './model';
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

export const suggestLifecycles = (model: LifecycleModel): LifecycleSuggestion[] =>
  model.aggregates
    .filter((aggregate) => !aggregate.declared && aggregate.fields.length > 0)
    .map((aggregate) => ({
      className: aggregate.name,
      file: aggregate.file,
      fields: aggregate.fields.map((field) => ({ field, terminal: terminalGuess(aggregate, field) })),
    }));
