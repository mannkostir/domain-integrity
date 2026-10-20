import { LifecycleFinding } from '../../../finding';
import { AggregateModel, LifecycleModel } from '../model';
import { CheckOptions } from './options';
import { outsideMutation } from './outside-mutation';
import { terminalStateLeak } from './terminal-state-leak';
import { transitionDrift } from './transition-drift';
import { unreachableState } from './unreachable-state';

export { LIFECYCLE_RULES } from './rules';

type Check = (aggregate: AggregateModel, options: CheckOptions) => LifecycleFinding[];

const CHECKS: readonly Check[] = [terminalStateLeak, unreachableState, outsideMutation, transitionDrift];

const byLocation = (a: LifecycleFinding, b: LifecycleFinding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId);

export const runChecks = (model: LifecycleModel): LifecycleFinding[] => {
  const options: CheckOptions = { reportTestFileMutations: model.reportTestFileMutations };
  return model.aggregates.flatMap((aggregate) => CHECKS.flatMap((check) => check(aggregate, options))).sort(byLocation);
};
