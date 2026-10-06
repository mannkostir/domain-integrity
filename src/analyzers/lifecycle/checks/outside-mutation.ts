import { LifecycleFinding } from '../../../analyzer';
import { AggregateModel } from '../model';

export const outsideMutation = (aggregate: AggregateModel): LifecycleFinding[] =>
  aggregate.outside
    .filter((assignment) => aggregate.declarations.has(assignment.field))
    .filter((assignment) => !assignment.throughOwnSetter)
    .map((assignment) => ({
      analyzer: 'lifecycle',
      checkId: 'outside-mutation',
      severity: 'error',
      aggregate: aggregate.name,
      aggregateId: aggregate.id,
      method: undefined,
      field: assignment.field,
      subject: assignment.scope,
      file: assignment.file,
      line: assignment.line,
      message: `${assignment.field} of ${aggregate.name} is assigned outside the aggregate in ${assignment.scope}.`,
      fix: `Move this change into a method on ${aggregate.name} so its guards apply.`,
    }));
