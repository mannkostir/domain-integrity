import { RuleDescription } from '../../../analyzer';
import { EventFlowFinding } from '../../../finding';

export const DEAD_HANDLER: RuleDescription<'dead-handler'> = {
  id: 'dead-handler',
  severity: 'error',
  description: 'A handler is registered for an event class that production code never constructs.',
  explanation:
    'A handler is registered for an event class that no production code constructs, so the handler never runs. Usually the event was never published where it happens, or it was removed and the handler was left behind.',
  remedy:
    'Publish the event where it happens, or delete the handler. Accept the finding into the baseline only if the event is honestly constructed by code the analysis cannot see, such as code outside the analysed files.',
};

export const HANDLER_PAYLOAD_MISMATCH: RuleDescription<'handler-payload-mismatch'> = {
  id: 'handler-payload-mismatch',
  severity: 'error',
  description: 'A handler is registered for one event class but declares its event as an unrelated class.',
  explanation:
    'A handler is registered for one event class but types its event parameter as an unrelated class. The handler is then handed an event of a different class than it expects.',
  remedy:
    'Type the parameter as the registered event class, or register the handler for the class it declares. Accept the finding into the baseline only while it is a known defect you mean to fix.',
};

export const UNHANDLED_EVENT: RuleDescription<'unhandled-event'> = {
  id: 'unhandled-event',
  severity: 'error',
  description: 'A declared in-process event is constructed but has no handler.',
  explanation:
    'An event class listed in events.inProcess is constructed in production code, but no handler is registered for it, so the event is raised and nothing reacts to it. It runs only for the classes declared in events.inProcess.',
  remedy:
    'Add a handler for the event, or, if it is consumed elsewhere, such as by another process, remove it from events.inProcess in domain.config.ts. Accept the finding into the baseline only while it is a known gap you mean to close.',
};

export const SAGA_MISSING_FAILURE_PATH: RuleDescription<'saga-missing-failure-path'> = {
  id: 'saga-missing-failure-path',
  severity: 'error',
  description: 'A saga handles the success event of a declared outcome but not its failure event.',
  explanation:
    'A saga declared with saga() handles the success event of a declared outcome but not its failure event, so a failure leaves the process stuck halfway with nothing to compensate. It runs only for sagas and outcomes declared in events.sagas.',
  remedy:
    'Handle the failure event in the saga, for example with a compensating command. If the outcome is declared wrongly, correct it in events.sagas in domain.config.ts. Accept the finding into the baseline only if the failure is honestly handled somewhere the analysis cannot see.',
  experimental: true,
};

export const UNDISPATCHED_EVENTS: RuleDescription<'undispatched-events'> = {
  id: 'undispatched-events',
  severity: 'error',
  description: 'An event method stores events in a buffer that production code never reads or drains.',
  explanation:
    'An event method pushes events onto a private buffer that no production code reads or drains, so every event raised into it is silently lost. It is reported only when the analysis can prove that nothing reads the buffer.',
  remedy:
    'Dispatch the events in the buffer after saving the aggregate and clear it, or stop raising them. Accept the finding into the baseline only if the buffer is honestly read by code the analysis cannot see, such as reflection or library code.',
};

export const EVENT_FLOW_RULES: readonly RuleDescription<EventFlowFinding['ruleId']>[] = [
  DEAD_HANDLER,
  HANDLER_PAYLOAD_MISMATCH,
  UNHANDLED_EVENT,
  SAGA_MISSING_FAILURE_PATH,
  UNDISPATCHED_EVENTS,
];
