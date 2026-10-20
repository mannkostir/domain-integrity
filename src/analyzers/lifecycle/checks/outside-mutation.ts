import { LifecycleFinding, reportedUnder } from '../../../analyzer';
import { AggregateModel } from '../model';
import { CheckOptions } from './options';
import { OUTSIDE_MUTATION } from './rules';

export const outsideMutation = (aggregate: AggregateModel, options: CheckOptions): LifecycleFinding[] =>
  aggregate.outside
    .filter((assignment) => options.reportTestFileMutations || !assignment.inTestFile)
    .filter((assignment) => aggregate.declarations.has(assignment.field))
    .filter((assignment) => !assignment.throughOwnSetter)
    .map((assignment) => ({
      analyzer: 'lifecycle',
      ...reportedUnder(OUTSIDE_MUTATION),
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
