import { EventFlowFinding } from '../../../analyzer';
import { EventFlowModel } from '../model';
import { deadHandler } from './dead-handler';
import { handlerPayloadMismatch } from './handler-payload-mismatch';
import { sagaMissingFailurePath } from './saga-missing-failure-path';
import { undispatchedEvents } from './undispatched-events';
import { unhandledEvent } from './unhandled-event';

export { EVENT_FLOW_RULES } from './rules';

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
