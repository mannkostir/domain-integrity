import { Finding } from '../../../analyzer';
import { AggregateModel } from '../model';

export const outsideMutation = (aggregate: AggregateModel): Finding[] =>
  aggregate.outside
    .filter((assignment) => aggregate.declarations.has(assignment.field))
    .map((assignment) => ({
      checkId: 'outside-mutation',
      severity: 'error',
      aggregate: aggregate.name,
      method: undefined,
      field: assignment.field,
      subject: assignment.scope,
      file: assignment.file,
      line: assignment.line,
      message: `${assignment.field} of ${aggregate.name} is assigned outside the aggregate in ${assignment.scope}.`,
      fix: `Move this change into a method on ${aggregate.name} so its guards apply.`,
    }));
