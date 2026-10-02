import { Finding, RuleDescription } from '../../../analyzer';
import { LifecycleModel } from '../model';
import { outsideMutation } from './outside-mutation';
import { terminalStateLeak } from './terminal-state-leak';
import { transitionDrift } from './transition-drift';
import { unreachableState } from './unreachable-state';

export const LIFECYCLE_RULES: readonly RuleDescription[] = [
  { id: 'terminal-state-leak', description: 'A method can change an aggregate after it reached a terminal state.' },
  { id: 'unreachable-state', description: 'A declared state value is never assigned.' },
  { id: 'outside-mutation', description: 'Aggregate state is assigned outside the aggregate.' },
  { id: 'transition-drift', description: "A method's allowed source states differ from its declared transition." },
];

const CHECKS = [terminalStateLeak, unreachableState, outsideMutation, transitionDrift];

const byLocation = (a: Finding, b: Finding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.checkId.localeCompare(b.checkId);

export const runChecks = (model: LifecycleModel): Finding[] =>
  model.aggregates.flatMap((aggregate) => CHECKS.flatMap((check) => check(aggregate))).sort(byLocation);
