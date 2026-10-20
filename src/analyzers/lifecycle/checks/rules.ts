import { RuleDescription } from '../../../analyzer';
import { LifecycleFinding } from '../../../finding';

export const TERMINAL_STATE_LEAK: RuleDescription<'terminal-state-leak'> = {
  id: 'terminal-state-leak',
  severity: 'error',
  description: 'A method can change an aggregate after it reached a terminal state.',
  explanation:
    'A public method has no guard that stops it once a state field holds a declared terminal value, so it can still change an aggregate that is meant to be finished. A cancelled order that can still be shipped, or a closed account that still takes deposits, is a broken business rule.',
  remedy:
    'Guard the method with an early return or throw on the state field so it cannot run from the terminal value. If changing a finished aggregate is intended, as for a remove method, list the method in allowAfterTerminal in domain.config.ts. Accept the finding into the baseline only while it is a known defect you mean to fix.',
};

export const UNREACHABLE_STATE: RuleDescription<'unreachable-state'> = {
  id: 'unreachable-state',
  severity: 'error',
  description: 'A declared state value is never assigned.',
  explanation:
    'A value of the state field type is never assigned anywhere in the analysed code, so no aggregate can ever reach it. Either the method that should move the aggregate into that state is missing, or the type carries a value that no longer means anything.',
  remedy:
    'Add the method that moves the aggregate into that value, or remove the value from the type. Accept the finding into the baseline only if the value is honestly set by code the analysis cannot see, such as a database write.',
};

export const OUTSIDE_MUTATION: RuleDescription<'outside-mutation'> = {
  id: 'outside-mutation',
  severity: 'error',
  description: 'Aggregate state is assigned outside the aggregate.',
  explanation:
    "A state field is assigned from code outside the aggregate, such as a service, mapper or specification, so the aggregate's guards and transitions are bypassed. A write through the aggregate's own setter is not reported, and neither are assignments in test files unless reportTestFileMutations is true.",
  remedy:
    'Move the change into a method on the aggregate so its guards apply, and call that method instead. Accept the finding into the baseline only if the assignment honestly has to stay where it is, such as a persistence mapper that rebuilds a stored aggregate.',
};

export const TRANSITION_DRIFT: RuleDescription<'transition-drift'> = {
  id: 'transition-drift',
  severity: 'error',
  description:
    'A method can run from states its declared transition does not allow, or sets the state field without a declared transition.',
  explanation:
    'A method can run from states that its entry in transitions does not list, or it sets the state field while transitions has no entry for it. The code then allows more than the declared lifecycle, so the declaration no longer describes what the aggregate does.',
  remedy:
    "Add a guard that excludes the extra states, or, if the code is right, add those states to the method's entry in transitions in domain.config.ts, or add an entry for a method that has none. Accept the finding into the baseline only while it is a known defect you mean to fix.",
};

export const TRANSITION_MISSING: RuleDescription<'transition-missing'> = {
  id: 'transition-missing',
  severity: 'warning',
  description: 'A method cannot run from a state its declared transition allows.',
  explanation:
    "A method's guard keeps it from running in a state that its entry in transitions lists, so the declaration promises a transition the code no longer offers. It is a warning: the code is not breaking a rule, but the declaration has drifted from it.",
  remedy:
    "Remove the state from the method's entry in transitions in domain.config.ts, or relax the guard if the method should still run from it. Accept the finding into the baseline only while it is a known gap you mean to resolve.",
};

export const LIFECYCLE_RULES: readonly RuleDescription<LifecycleFinding['ruleId']>[] = [
  TERMINAL_STATE_LEAK,
  UNREACHABLE_STATE,
  OUTSIDE_MUTATION,
  TRANSITION_DRIFT,
  TRANSITION_MISSING,
];
