import { LifecycleCheckId, RuleDescription } from '../../../analyzer';

export const TERMINAL_STATE_LEAK: RuleDescription<'terminal-state-leak'> = {
  id: 'terminal-state-leak',
  severity: 'error',
  description: 'A method can change an aggregate after it reached a terminal state.',
};

export const UNREACHABLE_STATE: RuleDescription<'unreachable-state'> = {
  id: 'unreachable-state',
  severity: 'error',
  description: 'A declared state value is never assigned.',
};

export const OUTSIDE_MUTATION: RuleDescription<'outside-mutation'> = {
  id: 'outside-mutation',
  severity: 'error',
  description: 'Aggregate state is assigned outside the aggregate.',
};

export const TRANSITION_DRIFT: RuleDescription<'transition-drift'> = {
  id: 'transition-drift',
  severity: 'error',
  description:
    'A method can run from states its declared transition does not allow, or sets the state field without a declared transition.',
};

export const TRANSITION_MISSING: RuleDescription<'transition-missing'> = {
  id: 'transition-missing',
  severity: 'warning',
  description: 'A method cannot run from a state its declared transition allows.',
};

export const LIFECYCLE_RULES: readonly RuleDescription<LifecycleCheckId>[] = [
  TERMINAL_STATE_LEAK,
  UNREACHABLE_STATE,
  OUTSIDE_MUTATION,
  TRANSITION_DRIFT,
  TRANSITION_MISSING,
];
