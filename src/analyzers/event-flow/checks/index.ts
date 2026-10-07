import { EventFlowFinding, RuleDescription } from '../../../analyzer';
import { EventFlowModel } from '../model';
import { deadHandler } from './dead-handler';
import { handlerPayloadMismatch } from './handler-payload-mismatch';
import { sagaMissingFailurePath } from './saga-missing-failure-path';
import { undispatchedEvents } from './undispatched-events';
import { unhandledEvent } from './unhandled-event';

export const EVENT_FLOW_RULES: readonly RuleDescription[] = [
  { id: 'dead-handler', description: 'A handler is registered for an event class that production code never constructs.' },
  { id: 'handler-payload-mismatch', description: 'A handler is registered for one event class but declares its event as an unrelated class.' },
  { id: 'unhandled-event', description: 'A declared in-process event is constructed but has no handler.' },
  { id: 'saga-missing-failure-path', description: 'A saga handles the success event of a declared outcome but not its failure event.' },
  { id: 'undispatched-events', description: 'An event method stores events in a buffer that production code never reads or drains.' },
];

const CHECKS: readonly ((model: EventFlowModel) => readonly EventFlowFinding[])[] = [
  deadHandler,
  handlerPayloadMismatch,
  unhandledEvent,
  sagaMissingFailurePath,
  undispatchedEvents,
];

const byLocation = (a: EventFlowFinding, b: EventFlowFinding): number =>
  a.file.localeCompare(b.file) || a.line - b.line || a.checkId.localeCompare(b.checkId);

export const runEventFlowChecks = (model: EventFlowModel): EventFlowFinding[] => CHECKS.flatMap((check) => check(model)).sort(byLocation);
