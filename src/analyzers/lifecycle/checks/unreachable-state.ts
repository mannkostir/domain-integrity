import { Finding } from '../../../analyzer';
import { AggregateModel, AssignedValues, StateField } from '../model';
import { hasUnknownWrite } from '../values';
import { fieldOf } from './format';

const assignmentsOf = (aggregate: AggregateModel, field: StateField): AssignedValues[] =>
  [
    ...aggregate.methods.map((method) => method.fields.get(field.name)?.sets),
    aggregate.initial.get(field.name),
    ...aggregate.outside.filter((assignment) => assignment.field === field.name).map((assignment) => assignment.value),
  ].filter((value): value is AssignedValues => value !== undefined);

const unreachableValues = (aggregate: AggregateModel, field: StateField): Finding[] => {
  const assignments = assignmentsOf(aggregate, field);
  if (assignments.some(hasUnknownWrite)) return [];
  const reached = new Set([
    ...assignments.flatMap((value) => [...value.tokens]),
    ...(aggregate.mentioned.get(field.name) ?? []),
  ]);
  return field.values
    .filter((value) => !reached.has(value.token))
    .map((value) => ({
      checkId: 'unreachable-state',
      severity: 'error',
      aggregate: aggregate.name,
      aggregateId: aggregate.id,
      method: undefined,
      field: field.name,
      subject: value.token,
      file: aggregate.file,
      line: aggregate.line,
      message: `${field.name} value '${value.label}' is never assigned.`,
      fix: `Add the method that moves ${aggregate.name} into '${value.label}', or remove the value from the type.`,
    }));
};

export const unreachableState = (aggregate: AggregateModel): Finding[] =>
  [...aggregate.declarations.keys()]
    .map((name) => fieldOf(aggregate, name))
    .filter((field) => field.kind === 'enum' || field.kind === 'union')
    .flatMap((field) => unreachableValues(aggregate, field));
