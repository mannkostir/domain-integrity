import { reportedUnder } from '../../../analyzer';
import { FindingOf } from '../../../finding';
import { AggregateModel } from '../model';
import { CheckOptions } from './options';
import { OUTSIDE_MUTATION } from './rules';

export const outsideMutation = (aggregate: AggregateModel, options: CheckOptions): FindingOf<'outside-mutation'>[] =>
  aggregate.outside
    .filter((assignment) => options.reportTestFileMutations || !assignment.inTestFile)
    .filter((assignment) => aggregate.declarations.has(assignment.field))
    .filter((assignment) => !assignment.throughOwnSetter)
    .map((assignment): FindingOf<'outside-mutation'> => ({
      ...reportedUnder(OUTSIDE_MUTATION),
      analyzer: 'lifecycle',
      file: assignment.file,
      line: assignment.line,
      message: `${assignment.field} of ${aggregate.name} is assigned outside the aggregate in ${assignment.scope}.`,
      fix: `Move this change into a method on ${aggregate.name} so its guards apply.`,
      details: { aggregate: aggregate.name, aggregateId: aggregate.id, field: assignment.field, scope: assignment.scope },
    }));
