import { AggregateModel, StateField } from '../model';

export const labelsOf = (field: StateField, tokens: Iterable<string>): string[] => {
  const wanted = new Set(tokens);
  return field.values.filter((value) => wanted.has(value.token)).map((value) => value.label);
};

export const quoted = (field: StateField, tokens: Iterable<string>): string =>
  labelsOf(field, tokens)
    .map((label) => `'${label}'`)
    .join(', ');

export const fieldOf = (aggregate: AggregateModel, name: string): StateField => {
  const field = aggregate.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`${aggregate.name} has a declaration for unresolved field "${name}"`);
  return field;
};
