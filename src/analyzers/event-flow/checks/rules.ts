import { EventFlowFinding, RuleDescription } from '../../../analyzer';

export const DEAD_HANDLER: RuleDescription<'dead-handler'> = {
  id: 'dead-handler',
  severity: 'error',
  description: 'A handler is registered for an event class that production code never constructs.',
};

export const HANDLER_PAYLOAD_MISMATCH: RuleDescription<'handler-payload-mismatch'> = {
  id: 'handler-payload-mismatch',
  severity: 'error',
  description: 'A handler is registered for one event class but declares its event as an unrelated class.',
};

export const UNHANDLED_EVENT: RuleDescription<'unhandled-event'> = {
  id: 'unhandled-event',
  severity: 'error',
  description: 'A declared in-process event is constructed but has no handler.',
};

export const SAGA_MISSING_FAILURE_PATH: RuleDescription<'saga-missing-failure-path'> = {
  id: 'saga-missing-failure-path',
  severity: 'error',
  description: 'A saga handles the success event of a declared outcome but not its failure event.',
};

export const UNDISPATCHED_EVENTS: RuleDescription<'undispatched-events'> = {
  id: 'undispatched-events',
  severity: 'error',
  description: 'An event method stores events in a buffer that production code never reads or drains.',
};

export const EVENT_FLOW_RULES: readonly RuleDescription<EventFlowFinding['checkId']>[] = [
  DEAD_HANDLER,
  HANDLER_PAYLOAD_MISMATCH,
  UNHANDLED_EVENT,
  SAGA_MISSING_FAILURE_PATH,
  UNDISPATCHED_EVENTS,
];
