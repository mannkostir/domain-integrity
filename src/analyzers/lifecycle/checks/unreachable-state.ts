import { reportedUnder } from '../../../analyzer';
import { UNSET } from '../../../engine/value-token';
import { FindingOf } from '../../../finding';
import { AggregateModel, AssignedValues, StateField } from '../model';
import { hasUnknownWrite } from '../values';
import { fieldOf } from './format';
import { UNREACHABLE_STATE } from './rules';

const assignmentsOf = (aggregate: AggregateModel, field: StateField): AssignedValues[] =>
  [
    ...aggregate.methods.map((method) => method.fields.get(field.name)?.sets),
    aggregate.initial.get(field.name),
    ...aggregate.outside.filter((assignment) => assignment.field === field.name).map((assignment) => assignment.value),
  ].filter((value): value is AssignedValues => value !== undefined);

const unreachableValues = (aggregate: AggregateModel, field: StateField): FindingOf<'unreachable-state'>[] => {
  const assignments = assignmentsOf(aggregate, field);
  if (assignments.some(hasUnknownWrite)) return [];
  const reached = new Set([
    ...assignments.flatMap((value) => [...value.tokens]),
    ...(aggregate.mentioned.get(field.name) ?? []),
  ]);
  return field.values
    .filter((value) => value.token !== UNSET && !reached.has(value.token))
    .map((value): FindingOf<'unreachable-state'> => ({
      ...reportedUnder(UNREACHABLE_STATE),
      analyzer: 'lifecycle',
      file: aggregate.file,
      line: aggregate.line,
      message: `${field.name} value '${value.label}' is never assigned.`,
      fix: `Add the method that moves ${aggregate.name} into '${value.label}', or remove the value from the type.`,
      details: { aggregate: aggregate.name, aggregateId: aggregate.id, field: field.name, value: value.token },
    }));
};

export const unreachableState = (aggregate: AggregateModel): FindingOf<'unreachable-state'>[] =>
  [...aggregate.declarations.keys()]
    .map((name) => fieldOf(aggregate, name))
    .filter((field) => field.kind === 'enum' || field.kind === 'union')
    .flatMap((field) => unreachableValues(aggregate, field));
